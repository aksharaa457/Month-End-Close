"""Variances (FX-1..FX-8). Recomputed and stored after each sync / threshold
change (ARCHITECTURE P-1); reads come straight from flux.variances."""

from __future__ import annotations

import hashlib
from decimal import Decimal
from typing import Any

from app.core.db import Db
from app.core.serialize import num, sid
from app.services.common import ai_by_ids, period, period_row, prior_period

ZERO = Decimal("0")


def is_flagged(prior: Decimal, current: Decimal, abs_amount: Decimal, pct: Decimal) -> bool:
    """Flag when EITHER the amount OR the percentage threshold trips (FX-2).
    With a zero prior, only the amount applies (EC-3)."""
    delta = current - prior
    pct_trip = prior != 0 and abs(delta / prior) * 100 > pct
    return abs(delta) > abs_amount or pct_trip


async def thresholds(db: Db, entity_id: Any) -> dict[str | None, dict[str, Any]]:
    """Latest threshold per account class (None = entity default)."""
    rows = await db.all(
        """SELECT DISTINCT ON (account_class) * FROM flux.thresholds
            WHERE entity_id = :e ORDER BY account_class, version DESC""",
        e=entity_id,
    )
    return {r["account_class"]: r for r in rows}


def _tree(accounts: list[dict[str, Any]]) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    children: dict[str, list[dict[str, Any]]] = {}
    roots = []
    for a in accounts:
        if a["parent_account_id"]:
            children.setdefault(str(a["parent_account_id"]), []).append(a)
        else:
            roots.append(a)
    for v in children.values():
        v.sort(key=lambda x: x["erp_account_code"])
    roots.sort(key=lambda a: (0 if a["account_class"] == "revenue" else 1, a["erp_account_code"]))
    return children, roots


async def recompute(db: Db, entity_id: Any) -> list[Any]:
    """Recompute every account's variance for the open period. Keeps human
    decisions; marks signed-off lines whose numbers moved (EC-6). Returns the
    account ids that are flagged but have no explanation yet."""
    p = await period_row(db, entity_id)
    if p["status"] == "locked":
        return []
    accounts = await db.all("SELECT * FROM brain.accounts WHERE entity_id = :e", e=entity_id)
    bal = await db.all(
        "SELECT account_id, period, amount_functional FROM brain.gl_balances WHERE entity_id = :e AND period IN (:p, :pp)",
        e=entity_id, p=period(), pp=prior_period(),
    )
    cur = {str(b["account_id"]): b["amount_functional"] for b in bal if b["period"] == period()}
    pri = {str(b["account_id"]): b["amount_functional"] for b in bal if b["period"] == prior_period()}
    thr = await thresholds(db, entity_id)
    existing = {str(v["account_id"]): v for v in await db.all("SELECT * FROM flux.variances WHERE period_id = :p", p=p["id"])}
    ai_ok = {str(r["id"]) for r in await db.all("SELECT id FROM ai.ai_outputs WHERE outcome = 'ok' AND id IN (SELECT explanation_ai_output_id FROM flux.variances WHERE period_id = :p)", p=p["id"])}
    children, _ = _tree(accounts)
    memo: dict[str, tuple[Decimal, Decimal]] = {}

    def total(a: dict[str, Any]) -> tuple[Decimal, Decimal]:
        k = str(a["id"])
        if k not in memo:
            if a["is_group"]:
                pr = cu = ZERO
                for c in children.get(k, []):
                    x, y = total(c)
                    pr, cu = pr + x, cu + y
                memo[k] = (pr, cu)
            else:
                memo[k] = (pri.get(k, ZERO), cur.get(k, ZERO))
        return memo[k]

    needs_explaining = []
    currency = (await db.scalar("SELECT functional_currency FROM tenancy.entities WHERE id = :e", e=entity_id)).strip()
    for a in accounts:
        prior, current = total(a)
        delta = current - prior
        t = thr.get(a["account_class"]) or thr[None]
        top_level_total = a["is_group"] and not a["parent_account_id"]  # Income, Assets… are summaries
        flagged = not top_level_total and is_flagged(prior, current, t["abs_amount"], t["pct"])
        ex = existing.get(str(a["id"]))
        input_hash = hashlib.sha256(f"{prior}|{current}".encode()).digest()
        changed = ex is not None and (ex["prior_amount"] != prior or ex["current_amount"] != current)
        signed_by, exc_reason, changed_after = None, None, False
        if not flagged:
            status = "not_flagged"
        elif ex and ex["status"] in ("signed_off", "exception"):
            status, signed_by, exc_reason = ex["status"], ex["signed_off_by"], ex["exception_reason"]
            changed_after = bool(ex["changed_after_signoff"]) or changed
        elif ex and ex["explanation_ai_output_id"] and str(ex["explanation_ai_output_id"]) in ai_ok and not changed:
            status = "explained" if ex["status"] == "explained" else "open"
        elif ex and ex["explanation_ai_output_id"] and not changed:
            status = "needs_manual"
        else:
            status = "needs_manual"
            needs_explaining.append(a["id"])
        await db.exec(
            """INSERT INTO flux.variances
                 (tenant_id, period_id, account_id, currency, prior_amount, current_amount, delta, delta_pct,
                  is_flagged, threshold_id, status, explanation_ai_output_id, input_hash, signed_off_by,
                  exception_reason, changed_after_signoff, needs_entry)
               VALUES (:t, :p, :a, :ccy, :pr, :cu, :d, :dp, :f, :th, :st, :ex, :h, :sb, :er, :ca, CAST(:ne AS jsonb))
               ON CONFLICT (tenant_id, period_id, account_id) DO UPDATE SET
                 prior_amount = EXCLUDED.prior_amount, current_amount = EXCLUDED.current_amount, delta = EXCLUDED.delta,
                 delta_pct = EXCLUDED.delta_pct, is_flagged = EXCLUDED.is_flagged, threshold_id = EXCLUDED.threshold_id,
                 status = EXCLUDED.status, signed_off_by = EXCLUDED.signed_off_by, exception_reason = EXCLUDED.exception_reason,
                 changed_after_signoff = EXCLUDED.changed_after_signoff, input_hash = EXCLUDED.input_hash,
                 explanation_ai_output_id = CASE WHEN :chg THEN NULL ELSE flux.variances.explanation_ai_output_id END,
                 computed_at = now(),
                 version = flux.variances.version + CASE WHEN :chg THEN 1 ELSE 0 END""",
            t=db.tenant_id, p=p["id"], a=a["id"], ccy=currency, pr=prior, cu=current, d=delta,
            dp=None if prior == 0 else round(delta / abs(prior) * 100, 4),
            f=flagged, th=t["id"], st=status,
            ex=ex["explanation_ai_output_id"] if ex and (not changed or status in ("signed_off", "exception")) else None,
            h=input_hash, sb=signed_by, er=exc_reason, ca=changed_after,
            ne=(ex["needs_entry"] if ex else None), chg=changed and status not in ("signed_off", "exception"),
        )
    return needs_explaining


async def list_variances(db: Db, entity_id: Any) -> list[dict[str, Any]]:
    p = await period_row(db, entity_id)
    rows = await db.all(
        """SELECT v.*, a.erp_account_code, a.name AS account_name, a.account_class, a.parent_account_id, a.is_group, th.version AS threshold_version
             FROM flux.variances v
             JOIN brain.accounts a ON a.id = v.account_id
             JOIN flux.thresholds th ON th.id = v.threshold_id
            WHERE v.period_id = :p""",
        p=p["id"],
    )
    drafts = await db.all(
        """SELECT d.id, v.account_id AS source_account_id FROM journals.je_drafts d JOIN flux.variances v ON v.id = d.source_variance_id
            WHERE d.period_id = :p AND d.status <> 'withdrawn'""",
        p=p["id"],
    )
    draft_map: dict[str, list[str]] = {}
    for d in drafts:
        draft_map.setdefault(str(d["source_account_id"]), []).append(str(d["id"]))
    ai = await ai_by_ids(db, [r["explanation_ai_output_id"] for r in rows])
    by_acct = {str(r["account_id"]): r for r in rows}
    accounts = [
        {"id": r["account_id"], "erp_account_code": r["erp_account_code"], "account_class": r["account_class"], "parent_account_id": r["parent_account_id"], "is_group": r["is_group"]}
        for r in rows
    ]
    children, roots = _tree(accounts)
    out: list[dict[str, Any]] = []

    def visit(a: dict[str, Any], depth: int) -> None:
        r = by_acct[str(a["id"])]
        kids = children.get(str(a["id"]), [])
        delta = r["delta"]
        attributions = []
        if r["is_group"]:
            for c in kids:
                cr = by_acct[str(c["id"])]
                if cr["delta"] != 0:
                    attributions.append({
                        "accountId": str(c["id"]), "accountCode": cr["erp_account_code"], "accountName": cr["account_name"],
                        "amount": num(cr["delta"]), "sharePct": 0.0 if delta == 0 else round(float(cr["delta"] / delta * 100), 1),
                    })
            attributions.sort(key=lambda x: -abs(x["amount"] or 0))
        out.append({
            "id": str(r["account_id"]),
            "entityId": str(entity_id),
            "accountId": str(r["account_id"]),
            "accountCode": r["erp_account_code"],
            "accountName": r["account_name"],
            "accountClass": r["account_class"],
            "parentAccountId": sid(r["parent_account_id"]),
            "isGroup": r["is_group"],
            "depth": depth,
            "currency": r["currency"].strip(),
            "prior": num(r["prior_amount"]),
            "current": num(r["current_amount"]),
            "delta": num(delta),
            "deltaPct": None if r["delta_pct"] is None else round(float(r["delta_pct"]), 1),
            "isFlagged": r["is_flagged"],
            "thresholdVersion": r["threshold_version"],
            "status": r["status"],
            "explanation": ai.get(str(r["explanation_ai_output_id"])) if r["explanation_ai_output_id"] else None,
            "attributions": attributions,
            "signedOffBy": sid(r["signed_off_by"]),
            "exceptionReason": r["exception_reason"],
            "changedAfterSignoff": r["changed_after_signoff"],
            "draftIds": draft_map.get(str(r["account_id"]), []),
            "version": r["version"],
        })
        for c in kids:
            visit(c, depth + 1)

    for root in roots:
        visit(root, 0)
    return out


async def variance_context(db: Db, entity_id: Any, account_id: Any) -> dict[str, Any]:
    """Minimised payload for the AI gateway (ARCH §7.2): codes, amounts, record ids."""
    p = await period_row(db, entity_id)
    a = await db.one("SELECT * FROM brain.accounts WHERE id = :a", a=account_id)
    v = await db.one("SELECT * FROM flux.variances WHERE period_id = :p AND account_id = :a", p=p["id"], a=account_id)
    assert a and v
    kids = await db.all(
        """SELECT a.id, a.erp_account_code AS code, a.name, v.delta AS amount
             FROM brain.accounts a JOIN flux.variances v ON v.account_id = a.id AND v.period_id = :p
            WHERE a.parent_account_id = :a AND v.delta <> 0 ORDER BY abs(v.delta) DESC LIMIT 20""",
        p=p["id"], a=account_id,
    )
    lines = await db.all(
        """SELECT id, erp_line_ref AS ref, posting_date AS date, amount, memo FROM brain.gl_lines
            WHERE entity_id = :e AND period = :per AND (account_id = :a OR account_id IN (SELECT id FROM brain.accounts WHERE parent_account_id = :a))
            ORDER BY abs(amount) DESC LIMIT 25""",
        e=entity_id, per=period(), a=account_id,
    )
    return {
        "account": {"code": a["erp_account_code"], "name": a["name"], "class": a["account_class"]},
        "currency": v["currency"].strip(),
        "prior": v["prior_amount"],
        "current": v["current_amount"],
        "delta": v["delta"],
        "deltaPct": v["delta_pct"],
        "children": [{"id": str(k["id"]), "code": k["code"], "name": k["name"], "amount": k["amount"]} for k in kids],
        "lines": [{"id": str(ln["id"]), "ref": ln["ref"], "date": str(ln["date"]), "amount": ln["amount"], "memo": ln["memo"] or ""} for ln in lines],
        "related": [],
    }


async def approved_notes(db: Db, account_id: Any) -> list[dict[str, Any]]:
    return await db.all("SELECT id, text FROM flux.context_notes WHERE account_id = :a AND status = 'approved' ORDER BY decided_at", a=account_id)
