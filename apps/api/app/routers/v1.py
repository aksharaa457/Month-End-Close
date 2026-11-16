"""v1 modules: accruals (F8), recognition gating & auto-apply policy (F9, §10.1),
the read-only copilot (AI-1..AI-5) and consolidation (F11)."""

from __future__ import annotations

import json
import logging
import re
import uuid
from collections.abc import AsyncIterator
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.ai.gateway import OFFLINE_MODEL, AiResult, gateway
from app.core.audit import audit
from app.core.auth import session
from app.core.config import settings
from app.core.db import Arr, Db, tenant_tx
from app.core.errors import Problem, fail
from app.core.permissions import Principal
from app.core.serialize import iso, num, sid
from app.jobs.queue import enqueue
from app.services import close as C
from app.services.common import ai_by_ids, assert_open, close_day, entity_or_404, period, period_row
from app.services.flux import list_variances
from app.services.journals import drafts_json, next_number, policy_for
from app.services.recognition import MONTHLY_REVENUE, evaluate_contracts

router = APIRouter(prefix="/api/v1")
log = logging.getLogger("cch.v1")

ZERO = Decimal(0)
CENT = Decimal("0.01")
ONE = Decimal(1)


def _uuid(v: str) -> str:
    try:
        return str(uuid.UUID(v))
    except ValueError:
        raise fail(404, "Not found") from None


def _usd(n: Decimal | float | int) -> str:
    x = float(n)
    return f"{'-' if x < 0 else ''}${abs(x):,.0f}"


def _loc(n: float | None) -> str:
    """Number formatted like JS toLocaleString('en-US') (≤ 3 decimals)."""
    if n is None:
        return "n/a"
    s = f"{n:,.3f}".rstrip("0").rstrip(".")
    return s


def _jsnum(n: float | int | None) -> str:
    if n is None:
        return "n/a"
    return str(int(n)) if float(n).is_integer() else str(n)


def _r(n: Decimal, q: Decimal = ONE) -> Decimal:
    return n.quantize(q, rounding=ROUND_HALF_UP)


def _scale(ccy: str) -> Decimal:
    return Decimal(80) if ccy == "INR" else Decimal("3.67") if ccy == "AED" else ONE


def _per_key() -> str:
    return period().strftime("%Y-%m")


# ------------------------------------------------------------------ shared: AI-drafted journal entries
async def _account(db: Db, entity_id: Any, code: str, fallback_class: str) -> dict[str, Any]:
    a = await db.one(
        """SELECT id, erp_account_code, name FROM brain.accounts
            WHERE entity_id = :e AND NOT is_group AND (erp_account_code = :code OR account_class = :cls)
            ORDER BY (erp_account_code = :code) DESC, is_active DESC, erp_account_code LIMIT 1""",
        e=entity_id, code=code, cls=fallback_class,
    )
    if not a:
        raise fail(422, "No account to post to", f"This entity has no {fallback_class} account for the entry.", "no_account")
    return a


async def _new_draft(
    db: Db, p: Principal, entity: dict[str, Any], *, je_type: str, source_type: str, source_ref_id: Any, source_label: str,
    description: str, ai_output_id: Any, lines: list[tuple[dict[str, Any], Decimal, Decimal, str]],
) -> dict[str, Any]:
    pr = await period_row(db, entity["id"])
    pol = await policy_for(db, entity["id"])
    total = sum((ln[1] for ln in lines), ZERO)
    d = await db.insert("journals.je_drafts", {
        "number": await next_number(db), "period_id": pr["id"], "je_type": je_type, "source_type": source_type, "source_ref_id": source_ref_id,
        "source_label": source_label, "description": description, "status": "draft", "created_by_ai": True, "ai_output_id": ai_output_id,
        "preparer_id": p.id, "currency": entity["functional_currency"].strip(), "total_amount": total, "approval_policy_id": pol["id"],
        "requires_second_approval": total > pol["second_approval_above"],
    })
    for i, (acct, debit, credit, memo) in enumerate(lines, start=1):
        await db.insert("journals.je_lines", {"draft_id": d["id"], "line_no": i, "account_id": acct["id"], "debit": debit, "credit": credit, "memo": memo}, returning="id")
    return d


# ------------------------------------------------------------------ accruals (F8)
def _proposal_json(r: dict[str, Any], ai: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": str(r["id"]), "entityId": str(r["entity_id"]), "vendor": r["vendor"], "category": r["category"], "basis": r["basis"],
        "amount": num(r["amount"]), "currency": r["currency"].strip(), "evidence": r["evidence"], "status": r["status"],
        "dismissReason": r["dismiss_reason"], "draftId": sid(r["draft_id"]), "ai": ai.get(str(r["ai_output_id"])),
    }


async def _proposal_out(db: Db, prop_id: Any) -> dict[str, Any]:
    r = await db.one("SELECT * FROM accruals.proposals WHERE id = :id", id=prop_id)
    assert r
    return _proposal_json(r, await ai_by_ids(db, [r["ai_output_id"]]))


@router.get("/entities/{entity_id}/accruals")
async def accruals_view(entity_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (_p, db):
        e = await entity_or_404(db, entity_id)
        ccy = e["functional_currency"].strip()
        scale = _scale(ccy)
        cats = await db.all(
            """SELECT category, actual, run_rate FROM accruals.category_spend WHERE entity_id = :e AND period = :per
                ORDER BY coalesce(array_position(ARRAY['Software', 'Hosting / Cloud', 'Professional', 'Marketing', 'Travel'], category), 99), category""",
            e=e["id"], per=period(),
        )
        props = await db.all("SELECT * FROM accruals.proposals WHERE entity_id = :e AND period = :per ORDER BY amount DESC, vendor", e=e["id"], per=period())
        ai = await ai_by_ids(db, [r["ai_output_id"] for r in props])
        sugg = [r for r in props if r["status"] == "suggested"]
        approved = sum((r["amount"] for r in props if r["status"] == "approved"), ZERO)
        return {
            "currency": ccy,
            "kpis": {
                "categorySpend": num(sum((c["actual"] for c in cats), ZERO)),
                "runRate": num(sum((c["run_rate"] for c in cats), ZERO)),
                "accruedLiabilities": num(_r(Decimal(64500) * scale + approved)),
                "prepaidAssets": num(_r(Decimal(11500) * scale)),
                "needsAccrual": len(sugg),
                "suggestedTotal": num(sum((r["amount"] for r in sugg), ZERO)),
            },
            "categories": [{"category": c["category"], "actual": num(c["actual"]), "runRate": num(c["run_rate"])} for c in cats],
            "proposals": [_proposal_json(r, ai) for r in props],
        }


async def _proposal_for_decision(db: Db, p: Principal, prop_id: str) -> dict[str, Any]:
    r = await db.one("SELECT * FROM accruals.proposals WHERE id = :id FOR UPDATE", id=_uuid(prop_id))
    if not r:
        raise fail(404, "Proposal not found")
    p.require("je.prepare", r["entity_id"])
    await assert_open(db, r["entity_id"])
    if r["status"] != "suggested":
        raise fail(409, "Already decided")
    return r


class AccrualApproveIn(BaseModel):
    amount: Decimal | None = None


@router.post("/accruals/{prop_id}/approve")
async def approve_accrual(prop_id: str, request: Request, body: AccrualApproveIn | None = None) -> dict[str, Any]:
    async with session(request) as (p, db):
        r = await _proposal_for_decision(db, p, prop_id)
        amount = r["amount"] if body is None or body.amount is None else _r(body.amount, CENT)
        if not amount > 0:
            raise fail(422, "Amount must be positive")
        e = await entity_or_404(db, r["entity_id"])
        exp = await _account(db, e["id"], "60301004" if r["category"].startswith("Hosting") else "61001002", "expense")
        liab = await _account(db, e["id"], "21001000", "liability")
        d = await _new_draft(
            db, p, e, je_type="accrual", source_type="accrual_proposal", source_ref_id=r["id"], source_label=f"Accrual · {r['vendor']}",
            description=f"Accrual — {r['vendor']} ({r['category']}), reverses 1 Sep 2026", ai_output_id=r["ai_output_id"],
            lines=[(exp, amount, ZERO, r["vendor"]), (liab, ZERO, amount, "Auto-reverse 1 Sep")],
        )
        await db.exec(
            "UPDATE accruals.proposals SET status = 'approved', amount = :a, draft_id = :d, decided_by = :u, decided_at = now() WHERE id = :id",
            a=amount, d=d["id"], u=p.id, id=r["id"],
        )
        await audit(db, "accrual.approved", "accrual", r["id"], f"Accrual for {r['vendor']} approved → draft {d['number']}", actor_id=p.id, entity_id=e["id"])
        return await _proposal_out(db, r["id"])


class DismissIn(BaseModel):
    reason: str = Field(default="", max_length=2000)


@router.post("/accruals/{prop_id}/dismiss")
async def dismiss_accrual(prop_id: str, body: DismissIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        r = await _proposal_for_decision(db, p, prop_id)
        reason = body.reason.strip()
        if len(reason) < 3:
            raise fail(422, "Reason required", "Say why this accrual isn't needed (AC-3).")
        await db.exec(
            "UPDATE accruals.proposals SET status = 'dismissed', dismiss_reason = :r, decided_by = :u, decided_at = now() WHERE id = :id",
            r=reason, u=p.id, id=r["id"],
        )
        await audit(db, "accrual.dismissed", "accrual", r["id"], f"Accrual for {r['vendor']} dismissed: {reason}", actor_id=p.id, entity_id=r["entity_id"])
        return await _proposal_out(db, r["id"])


# ------------------------------------------------------------------ recognition (F9, §10.1)
CONTRACT_ORDER = "ORDER BY CAST(substring(code FROM 'C-([0-9]+)') AS int) NULLS LAST, code"


def _contract_json(c: dict[str, Any]) -> dict[str, Any]:
    dec = None
    if c["decision_action"]:
        dec = {"action": c["decision_action"], "justification": c["decision_justification"], "by": sid(c["decided_by"]), "at": iso(c["decided_at"])}
    return {
        "id": str(c["id"]), "entityId": str(c["entity_id"]), "customer": c["customer"], "code": c["code"],
        "arr": num(c["arr"]), "monthly": num(c["monthly"]), "currency": c["currency"].strip(), "owner": c["owner_name"],
        "scheduleVersion": c["schedule_version"], "trigger": c["trigger_rule"], "evidence": c["evidence"] or [],
        "evidenceFound": c["evidence_found"], "modifiedThisPeriod": c["modified_this_period"], "confidence": num(c["confidence"]),
        "column": c["column_status"], "recommendation": c["recommendation"], "policyChecks": c["policy_checks"] or [],
        "decision": dec, "batchSignedOff": c["batch_signed_off"],
    }


def _policy_fields(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "enabled": r["enabled"], "version": r["version"], "maxPerItem": num(r["max_per_item"]), "maxPctOfRevenue": num(r["max_pct_revenue"]),
        "minConfidence": num(r["min_confidence"]), "historyPeriods": r["history_periods"], "aggregateCap": num(r["aggregate_cap"]),
    }


async def _policy_json(db: Db, entity_id: Any) -> dict[str, Any]:
    rows = await db.all("SELECT * FROM recognition.auto_apply_policies WHERE entity_id = :e AND status IN ('active', 'pending')", e=entity_id)
    act = next((r for r in rows if r["status"] == "active"), None)
    pend = next((r for r in rows if r["status"] == "pending"), None)
    s = await db.one("SELECT * FROM recognition.sampling WHERE entity_id = :e AND period = :per", e=entity_id, per=period())
    checked, errors = (s["checked"], s["errors"]) if s else (0, 0)
    out: dict[str, Any] = {"entityId": str(entity_id)}
    if act:
        out |= _policy_fields(act)
    else:
        out |= {"enabled": False, "version": 0, "maxPerItem": 5000.0, "maxPctOfRevenue": 0.5, "minConfidence": 0.9, "historyPeriods": 3, "aggregateCap": 50000.0}
    out["pendingChange"] = (_policy_fields(pend) | {"proposedBy": sid(pend["proposed_by"]), "approvals": [sid(pend["proposed_by"])] if pend["proposed_by"] else []}) if pend else None
    out["sampling"] = {"sampleSize": s["sample_size"] if s else 0, "checked": checked, "errors": errors,
                       "errorRatePct": round(errors / max(checked, 1) * 1000) / 10}
    return out


@router.get("/entities/{entity_id}/recognition")
async def recognition_view(entity_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (_p, db):
        e = await entity_or_404(db, entity_id)
        await evaluate_contracts(db, e["id"])
        contracts = await db.all(f"SELECT * FROM recognition.contracts WHERE entity_id = :e {CONTRACT_ORDER}", e=e["id"])
        started = sum((c["monthly"] for c in contracts if c["column_status"] == "started" or (c["column_status"] == "auto_applied" and c["batch_signed_off"])), ZERO)
        plan = await db.all("SELECT month, planned, recognised_base FROM recognition.monthly_plan WHERE entity_id = :e AND extract(year FROM month) = :y ORDER BY month",
                            e=e["id"], y=period().year)
        monthly = []
        for m in plan:
            if m["month"] < period():
                rec = m["recognised_base"]
            elif m["month"] == period():
                rec = m["recognised_base"] + started
            else:
                rec = ZERO
            monthly.append({"month": m["month"].strftime("%b"), "planned": num(_r(m["planned"])), "recognised": num(_r(rec))})
        open_reviews = len([c for c in contracts if c["column_status"] == "needs_review" and not c["decision_action"]])
        return {
            "monthly": monthly,
            "kpis": {
                "contractedArr": 25680000, "deviations": open_reviews + 115, "complianceRead": 11, "complianceTotal": 135,
                "monthlyRevenue": num(MONTHLY_REVENUE),
                "autoAppliedTotal": num(sum((c["monthly"] for c in contracts if c["column_status"] == "auto_applied"), ZERO)),
            },
            "contracts": [_contract_json(c) for c in contracts],
            "policy": await _policy_json(db, e["id"]),
        }


async def _contract(db: Db, p: Principal, contract_id: str) -> dict[str, Any]:
    c = await db.one("SELECT * FROM recognition.contracts WHERE id = :id FOR UPDATE", id=_uuid(contract_id))
    if not c:
        raise fail(404, "Contract not found")
    await assert_open(db, c["entity_id"])
    p.require("recognition.decide", c["entity_id"])
    return c


async def _contract_out(db: Db, contract_id: Any) -> dict[str, Any]:
    c = await db.one("SELECT * FROM recognition.contracts WHERE id = :id", id=contract_id)
    assert c
    return _contract_json(c)


class DecideIn(BaseModel):
    action: str = Field(default="start", max_length=20)
    justification: str = Field(default="", max_length=2000)


@router.post("/contracts/{contract_id}/decide")
async def decide_contract(contract_id: str, body: DecideIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        c = await _contract(db, p, contract_id)
        action = "defer" if body.action == "defer" else "start"
        justification = body.justification.strip()
        if action != (c["recommendation"] or {}).get("action") and len(justification) < 10:
            raise fail(422, "Justification required", "Overriding the AI recommendation needs a written justification (RR-6).", "justification_required")
        if action == "defer" and len(justification) < 10:
            raise fail(422, "Justification required", "Deferrals need a written justification (RR-6).", "justification_required")
        await db.exec(
            """UPDATE recognition.contracts SET decision_action = :a, decision_justification = :j, decided_by = :u, decided_at = now(), column_status = :col
                WHERE id = :id""",
            a=action, j=justification or None, u=p.id, col="deferred" if action == "defer" else "started", id=c["id"],
        )
        verb = "deferred" if action == "defer" else "started"
        what = "deferred to Sep" if action == "defer" else "recognition started in Aug"
        quoted = f' — "{justification}"' if justification else ""
        await audit(db, f"contract.{verb}", "contract", c["id"], f"{c['customer']}: {what}{quoted}", actor_id=p.id, entity_id=c["entity_id"])
        return await _contract_out(db, c["id"])


class PullBackIn(BaseModel):
    reason: str | None = Field(default=None, max_length=2000)


@router.post("/contracts/{contract_id}/pull-back")
async def pull_back_contract(contract_id: str, request: Request, body: PullBackIn | None = None) -> dict[str, Any]:
    async with session(request) as (p, db):
        c = await _contract(db, p, contract_id)
        if c["column_status"] != "auto_applied" or c["batch_signed_off"]:
            raise fail(409, "Can't pull back", "Only unsigned auto-applied items can be pulled back to review.")
        reason = (body.reason or "").strip() if body else ""
        await db.exec(
            """UPDATE recognition.contracts SET decision_action = 'pulled_back', decision_justification = :j, decided_by = :u, decided_at = now(),
                      column_status = 'needs_review' WHERE id = :id""",
            j=reason or None, u=p.id, id=c["id"],
        )
        await audit(db, "contract.pulled_back", "contract", c["id"], f"{c['customer']} pulled back from auto-apply for line review", actor_id=p.id, entity_id=c["entity_id"])
        return await _contract_out(db, c["id"])


@router.post("/contracts/{contract_id}/reset")
async def reset_contract(contract_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        c = await _contract(db, p, contract_id)
        await db.exec(
            "UPDATE recognition.contracts SET decision_action = NULL, decision_justification = NULL, decided_by = NULL, decided_at = NULL WHERE id = :id", id=c["id"]
        )
        await audit(db, "contract.decision_reset", "contract", c["id"], f"{c['customer']} decision withdrawn", actor_id=p.id, entity_id=c["entity_id"])
        await evaluate_contracts(db, c["entity_id"])
        return await _contract_out(db, c["id"])


@router.post("/entities/{entity_id}/recognition/auto-apply-batch/sign-off")
async def sign_off_batch(entity_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        e = await entity_or_404(db, entity_id)
        p.require("je.approve", e["id"])
        await assert_open(db, e["id"])
        await evaluate_contracts(db, e["id"])
        items = await db.all(
            "SELECT id, monthly FROM recognition.contracts WHERE entity_id = :e AND column_status = 'auto_applied' AND NOT batch_signed_off FOR UPDATE", e=e["id"]
        )
        if not items:
            raise fail(409, "Nothing to sign off")
        pol = await db.one("SELECT version FROM recognition.auto_apply_policies WHERE entity_id = :e AND status = 'active'", e=e["id"])
        await db.exec("UPDATE recognition.contracts SET batch_signed_off = true WHERE id = ANY(:ids)", ids=Arr([i["id"] for i in items], "uuid[]"))
        total = sum((i["monthly"] for i in items), ZERO)
        await audit(
            db, "recognition.batch_signed_off", "auto_apply_batch", uuid.uuid4(),
            f"Batch sign-off of {len(items)} auto-applied items ({_usd(total)}) under policy v{pol['version'] if pol else '?'} by {p.name}", actor_id=p.id, entity_id=e["id"],
        )
        return {"signedOff": len(items)}


async def _policy_ctx(db: Db, p: Principal, entity_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    e = await entity_or_404(db, entity_id)
    p.require("recognition.policy", e["id"])
    act = await db.one("SELECT * FROM recognition.auto_apply_policies WHERE entity_id = :e AND status = 'active' FOR UPDATE", e=e["id"])
    if not act:
        raise fail(404, "No policy for this entity")
    return e, act


class KillSwitchIn(BaseModel):
    enabled: bool


@router.post("/entities/{entity_id}/recognition/policy/kill-switch")
async def policy_kill_switch(entity_id: str, body: KillSwitchIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        e, act = await _policy_ctx(db, p, entity_id)
        await db.exec("UPDATE recognition.auto_apply_policies SET enabled = :en WHERE id = :id", en=body.enabled, id=act["id"])
        await audit(db, "auto_apply.kill_switch", "auto_apply_policy", e["id"], f"Auto-apply {'re-enabled' if body.enabled else 'switched OFF'} by {p.name}", actor_id=p.id, entity_id=e["id"])
        await evaluate_contracts(db, e["id"])
        return await _policy_json(db, e["id"])


class PolicyProposeIn(BaseModel):
    maxPerItem: Decimal
    maxPctOfRevenue: Decimal
    minConfidence: Decimal
    historyPeriods: int | None = Field(default=None, ge=0, le=36)
    aggregateCap: Decimal


@router.post("/entities/{entity_id}/recognition/policy/propose")
async def policy_propose(entity_id: str, body: PolicyProposeIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        e, act = await _policy_ctx(db, p, entity_id)
        if not (body.maxPerItem >= 0 and body.maxPctOfRevenue >= 0 and body.aggregateCap >= body.maxPerItem):
            raise fail(422, "Invalid limits", "The aggregate cap must be at least the per-item limit.")
        if not (Decimal("0.8") <= body.minConfidence <= 1):
            raise fail(422, "Invalid confidence", "Minimum confidence can't be set below 0.80 (§10.1).")
        # A new proposal replaces any pending one.
        await db.exec("UPDATE recognition.auto_apply_policies SET status = 'discarded' WHERE entity_id = :e AND status = 'pending'", e=e["id"])
        version = int(await db.scalar("SELECT coalesce(max(version), 0) + 1 FROM recognition.auto_apply_policies WHERE entity_id = :e", e=e["id"]))
        await db.insert("recognition.auto_apply_policies", {
            "entity_id": e["id"], "version": version, "status": "pending", "enabled": act["enabled"], "max_per_item": body.maxPerItem,
            "max_pct_revenue": body.maxPctOfRevenue, "min_confidence": body.minConfidence,
            "history_periods": body.historyPeriods if body.historyPeriods is not None else act["history_periods"],
            "aggregate_cap": body.aggregateCap, "proposed_by": p.id,
        }, returning="id")
        await audit(
            db, "auto_apply.change_proposed", "auto_apply_policy", e["id"],
            f"Policy v{version} proposed by {p.name}: {_usd(body.maxPerItem)} per item, cap {_usd(body.aggregateCap)}, confidence ≥ {_jsnum(float(body.minConfidence))}",
            actor_id=p.id, entity_id=e["id"],
        )
        return await _policy_json(db, e["id"])


@router.post("/entities/{entity_id}/recognition/policy/approve")
async def policy_approve(entity_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        e, act = await _policy_ctx(db, p, entity_id)
        pend = await db.one("SELECT * FROM recognition.auto_apply_policies WHERE entity_id = :e AND status = 'pending' FOR UPDATE", e=e["id"])
        if not pend:
            raise fail(409, "No pending change")
        if pend["proposed_by"] == p.id:
            raise fail(403, "Second approver required", "A different Controller or the CFO must approve the change (§10.1).", "sod_policy")
        # Order matters: the one-active unique index allows only one active row at a time.
        await db.exec("UPDATE recognition.auto_apply_policies SET status = 'superseded' WHERE id = :id", id=act["id"])
        await db.exec("UPDATE recognition.auto_apply_policies SET status = 'active', approved_by = :u WHERE id = :id", u=p.id, id=pend["id"])
        await audit(db, "auto_apply.change_approved", "auto_apply_policy", e["id"], f"Policy v{pend['version']} approved by {p.name} and now in effect", actor_id=p.id, entity_id=e["id"])
        await evaluate_contracts(db, e["id"])
        return await _policy_json(db, e["id"])


@router.post("/entities/{entity_id}/recognition/policy/discard")
async def policy_discard(entity_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        e, _act = await _policy_ctx(db, p, entity_id)
        await db.exec("UPDATE recognition.auto_apply_policies SET status = 'discarded' WHERE entity_id = :e AND status = 'pending'", e=e["id"])
        await audit(db, "auto_apply.change_discarded", "auto_apply_policy", e["id"], "Pending policy change discarded", actor_id=p.id, entity_id=e["id"])
        return await _policy_json(db, e["id"])


class SampleIn(BaseModel):
    error: bool = False


@router.post("/entities/{entity_id}/recognition/policy/sample")
async def policy_sample(entity_id: str, request: Request, body: SampleIn | None = None) -> dict[str, Any]:
    async with session(request) as (p, db):
        e, act = await _policy_ctx(db, p, entity_id)
        s = await db.one("SELECT * FROM recognition.sampling WHERE entity_id = :e AND period = :per FOR UPDATE", e=e["id"], per=period())
        if not s:
            raise fail(404, "No sample for this period")
        checked = min(s["sample_size"], s["checked"] + 1)
        errors = min(checked, s["errors"] + (1 if body and body.error else 0))
        await db.exec("UPDATE recognition.sampling SET checked = :c, errors = :er WHERE entity_id = :e AND period = :per", c=checked, er=errors, e=e["id"], per=period())
        rate = round(errors / max(checked, 1) * 1000) / 10
        if rate > 2 and checked >= 3 and act["enabled"]:
            await db.exec("UPDATE recognition.auto_apply_policies SET enabled = false WHERE id = :id", id=act["id"])
            await audit(db, "auto_apply.disabled_by_sampling", "auto_apply_policy", e["id"],
                        f"Sample error rate {_jsnum(rate)}% > 2% — auto-apply switched off pending Controller review", actor_type="system", entity_id=e["id"])
            await evaluate_contracts(db, e["id"])
        return await _policy_json(db, e["id"])


# ------------------------------------------------------------------ copilot (AI-1..AI-5)
class AskIn(BaseModel):
    question: str = Field(default="", max_length=2000)
    entityId: str | None = None


def _fact(cit: dict[str, Any], text: str) -> dict[str, Any]:
    return {"id": cit["recordId"], "type": cit["recordType"], "label": cit["label"], "text": text, "link": cit.get("link")}


async def _answer(db: Db, p: Principal, question: str, entity_id: str | None) -> dict[str, Any]:
    """Port of the mock answer(): the facts it uses become the model's only data."""
    text = question.lower()
    ents = await db.all("SELECT * FROM tenancy.entities ORDER BY parent_id NULLS FIRST, name")
    visible = [e for e in ents if p.can("view", e["id"])]
    ids = [str(e["id"]) for e in visible]
    if entity_id in ids:
        eid = entity_id
    else:
        first = next((e for e in visible if e["status"] == "active"), visible[0] if visible else None)
        eid = str(first["id"]) if first else None
    names = {str(e["id"]): e["name"] for e in visible}

    if visible and re.search(r"behind|plan|late|critical path|forecast", text):
        f = await C.forecast(db, visible)
        lines = "\n".join(f"• {d['label']}: {d['detail']}" for d in f["drags"])
        vd = f["varianceDays"]
        ans = (f"The group close is projected at D+{_jsnum(f['projectedCloseDay'])} against a plan of D+{_jsnum(f['planCloseDay'])} "
               f"({'+' if vd >= 0 else ''}{_jsnum(vd)} days). What's driving it:\n{lines}")
        cits = [{"recordType": "task", "recordId": d["link"], "label": d["label"], "link": d["link"]} for d in f["drags"]]
        facts = [{"id": "forecast", "type": "task", "label": "Close forecast", "link": "/",
                  "text": f"Projected close D+{_jsnum(f['projectedCloseDay'])}; plan D+{_jsnum(f['planCloseDay'])}."}]
        facts += [_fact(c, f"{d['label']}: {d['detail']}") for c, d in zip(cits, f["drags"], strict=True)]
        return {"text": ans, "citations": cits, "outcome": "ok", "facts": facts, "entityId": eid}

    contracts = await db.all(f"SELECT * FROM recognition.contracts WHERE entity_id = ANY(:ids) {CONTRACT_ORDER}", ids=Arr(ids, "uuid[]")) if ids else []
    contract = next((c for c in contracts if c["customer"].lower().split(" ")[0] in text), None)
    if contract is None and re.search(r"gating|recognition|asc 606", text):
        contract = next((c for c in contracts if c["column_status"] == "needs_review" and not c["decision_action"]), None)
    if contract:
        c = contract
        rec = c["recommendation"] or {}
        ans = (f"{c['customer']} ({c['code']}): ARR {_usd(c['arr'])}, {_usd(c['monthly'])} a month. It's in \"{c['column_status'].replace('_', ' ')}\". "
               f"Trigger: {c['trigger_rule']}. Evidence: {'; '.join(c['evidence'] or [])}. Recommendation: {rec.get('label', '')} — {rec.get('rationale', '')}")
        cit = {"recordType": "contract", "recordId": str(c["id"]), "label": f"{c['customer']} contract", "link": f"/e/{c['entity_id']}/recognition?contract={c['id']}"}
        return {"text": ans, "citations": [cit], "outcome": "ok", "facts": [_fact(cit, ans)], "entityId": str(c["entity_id"])}

    if eid and re.search(r"journal|draft|je\b|entries", text):
        ds = await drafts_json(db, "p.entity_id = CAST(:e AS uuid)", e=eid)

        def by(st: str) -> int:
            return len([d for d in ds if d["status"] == st])

        total = sum(d["totalDebit"] or 0 for d in ds if d["status"] not in ("withdrawn", "rejected"))
        ans = (f"{len(ds)} journal entries for {names.get(eid)}, totalling {_usd(total)}: {by('submitted')} awaiting approval, {by('draft')} drafts, "
               f"{by('posted')} posted and {by('post_failed')} approved but not posted. Every entry links to the variance and ledger data behind it.")
        cits = [{"recordType": "je_draft", "recordId": d["id"], "label": f"{d['number']} · {d['sourceLabel'] or d['description']}", "link": f"/e/{d['entityId']}/journals?draft={d['id']}"}
                for d in ds[:4]]
        facts = [{"id": "je-summary", "type": "je_draft", "label": "Journal entry summary", "link": f"/e/{eid}/journals", "text": ans}]
        facts += [_fact(c, f"{d['number']} {d['status']} {d['currency']} {d['totalDebit']}: {d['description']}") for c, d in zip(cits, ds[:4], strict=True)]
        return {"text": ans, "citations": cits, "outcome": "ok", "facts": facts, "entityId": eid}

    if eid:
        try:
            variances = await list_variances(db, eid)
        except Problem:
            variances = []
        v = next((x for x in variances if x["isFlagged"] and (x["accountName"].lower().split(" ")[0] in text or x["accountCode"] in text)), None)
        if v:
            ex = v["explanation"]
            ans = (f"{v['accountCode']} {v['accountName']}: {_loc(v['prior'])} → {_loc(v['current'])} ({_jsnum(v['deltaPct'])}%). "
                   f"{ex['text'] if ex else 'No AI explanation yet.'}"
                   + (f" Largest contributor: {v['attributions'][0]['accountName']} ({_jsnum(v['attributions'][0]['sharePct'])}%)." if v["attributions"] else ""))
            cit = {"recordType": "variance", "recordId": v["id"], "label": f"{v['accountCode']} {v['accountName']}", "link": f"/e/{v['entityId']}/flux?variance={v['id']}"}
            extra = list(ex["citations"]) if ex else []
            facts = [_fact(cit, ans)] + [_fact(x, x["label"]) for x in extra]
            return {"text": ans, "citations": [cit, *extra], "outcome": "ok", "facts": facts, "entityId": eid}

    if ids and re.search(r"overdue|task|checklist", text):
        ts = await db.all(
            """SELECT t.id, t.title, p.entity_id, e.name FROM close.tasks t JOIN close.periods p ON p.id = t.period_id JOIN tenancy.entities e ON e.id = p.entity_id
                WHERE p.period = :per AND p.entity_id = ANY(:ids) AND e.status = 'active' AND t.status <> 'completed' AND t.due_day < :cd ORDER BY t.due_day, t.title""",
            per=period(), ids=Arr(ids, "uuid[]"), cd=close_day(),
        )
        ans = f"{len(ts)} overdue tasks: {'; '.join(f'{t['title']} ({t['name']})' for t in ts[:5])}." if ts else "No tasks are overdue."
        cits = [{"recordType": "task", "recordId": str(t["id"]), "label": t["title"], "link": f"/e/{t['entity_id']}/checklist?task={t['id']}"} for t in ts[:5]]
        facts = [{"id": "overdue-summary", "type": "task", "label": "Overdue tasks", "link": "/", "text": ans}]
        facts += [_fact(c, f"Overdue task: {t['title']} ({t['name']})") for c, t in zip(cits, ts[:5], strict=True)]
        return {"text": ans, "citations": cits, "outcome": "ok", "facts": facts, "entityId": eid}

    return {
        "text": "I don't have data in the Enterprise Brain to answer that. I can answer questions about close status, overdue tasks, variances, journal entries and recognition decisions — for example \"Why are we behind plan?\".",
        "citations": [], "outcome": "insufficient_data", "facts": [], "entityId": eid,
    }


_MARK = re.compile(r"\s?\[\[[^\]]+\]\]")


def _split_safe(buf: str) -> tuple[str, str]:
    """Split streamed text into (ready to emit, held back) so [[id]] citation markers
    that arrive across chunks are never shown to the user."""
    cut = len(buf)
    i = buf.rfind("[[")
    if i != -1 and buf.find("]]", i) == -1:
        cut = i
    elif buf.endswith("["):
        cut = len(buf) - 1
    while cut > 0 and buf[cut - 1].isspace():
        cut -= 1
    return buf[:cut], buf[cut:]


def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def _record_answer(db: Db, p: Principal, question: str, prepared: dict[str, Any], text: str, citations: list[dict[str, Any]], model_id: str) -> Any:
    res = AiResult(
        kind="copilot_answer", text=text, outcome=prepared["outcome"], citations=citations, model_id=model_id, prompt_version="copilot@2",
        input_record_ids=[str(f["id"]) for f in prepared["facts"]],
    )
    ai_id = await gateway().record(db, res)
    await audit(db, "copilot.answered", "ai_output", ai_id, f'Copilot answered: "{question[:60]}"', actor_id=p.id, entity_id=prepared["entityId"])
    return ai_id


@router.post("/copilot/ask")
async def copilot_ask(body: AskIn, request: Request) -> StreamingResponse:
    gw = gateway()
    question = body.question.strip()
    ai_id: Any = None
    # Authenticate and gather every fact inside the session; streaming starts only afterwards.
    async with session(request) as (p, db):
        prepared = await _answer(db, p, question, body.entityId)
        if not gw.live:
            ai_id = await _record_answer(db, p, question, prepared, prepared["text"], prepared["citations"], OFFLINE_MODEL)
    tenant_id = p.tenant_id

    async def events() -> AsyncIterator[str]:
        nonlocal ai_id
        raw: list[str] = []
        held = ""
        async for chunk in gw.copilot_stream(question, prepared["facts"], prepared["text"]):
            raw.append(chunk)
            ready, held = _split_safe(held + chunk)
            ready = _MARK.sub("", ready)
            if ready:
                yield _sse("token", ready)
        tail = _MARK.sub("", held)
        if tail:
            yield _sse("token", tail)
        citations, model_id = prepared["citations"], OFFLINE_MODEL
        if gw.live:
            model_id = settings().ai_model
            clean, citations = gw.extract_citations("".join(raw), prepared["facts"])
            try:
                async with tenant_tx(tenant_id) as db2:
                    ai_id = await _record_answer(db2, p, question, prepared, clean, citations, model_id)
            except Exception:  # noqa: BLE001 - the answer was already shown; log rather than break the stream
                log.exception("could not record copilot answer")
        yield _sse("done", {"citations": citations, "outcome": prepared["outcome"], "aiOutputId": sid(ai_id), "modelId": model_id})

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ------------------------------------------------------------------ consolidation (F11)
async def _cons_period(db: Db) -> dict[str, Any]:
    await db.exec("INSERT INTO consolidation.periods (tenant_id, period) VALUES (:t, :p) ON CONFLICT DO NOTHING", t=db.tenant_id, p=period())
    row = await db.one("SELECT * FROM consolidation.periods WHERE period = :p", p=period())
    assert row
    return row


def _match_json(m: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(m["id"]), "fromEntityId": str(m["from_entity_id"]), "toEntityId": str(m["to_entity_id"]), "kind": m["kind"],
        "fromAmountUsd": num(m["from_amount_usd"]), "toAmountUsd": num(m["to_amount_usd"]), "difference": num(m["from_amount_usd"] - m["to_amount_usd"]),
        "tolerance": num(m["tolerance"]), "status": "resolved" if m.get("draft_status") == "posted" else m["status"],
        "likelyCause": m["likely_cause"], "explanation": m["explanation"], "trueUpDraftId": sid(m["true_up_draft_id"]),
    }


def _elim_json(e: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(e["id"]), "description": e["description"], "icMatchId": str(e["ic_match_id"]), "amount": num(e["amount"]), "status": e["status"],
            "preparedBy": sid(e["prepared_by"]), "approvedBy": sid(e["approved_by"])}


async def _rates(db: Db) -> dict[str, dict[str, Any]]:
    rows = await db.all("SELECT from_ccy, rate_type, rate, source FROM brain.fx_rates WHERE period = :p AND to_ccy = 'USD' ORDER BY from_ccy", p=period())
    out: dict[str, dict[str, Any]] = {}
    for r in rows:
        out.setdefault(r["from_ccy"].strip(), {"source": r["source"]})[r["rate_type"]] = r["rate"]
    return out


async def _consolidation_view(db: Db) -> dict[str, Any]:
    cp = await db.one("SELECT * FROM consolidation.periods WHERE period = :p", p=period()) or {"status": "not_started", "translation_run": False, "reviewed": False}
    active = await db.all(
        """SELECT e.*, p.status AS period_status FROM tenancy.entities e LEFT JOIN close.periods p ON p.entity_id = e.id AND p.period = :per
            WHERE e.status = 'active' ORDER BY e.parent_id NULLS FIRST, e.name""",
        per=period(),
    )
    rates = await _rates(db)

    def rate(ccy: str, kind: str) -> Decimal:
        return ONE if ccy == "USD" else rates.get(ccy, {}).get(kind) or ONE

    sums_rows = await db.all(
        """SELECT p.entity_id, a.account_class, sum(v.current_amount) AS total
             FROM flux.variances v JOIN brain.accounts a ON a.id = v.account_id JOIN close.periods p ON p.id = v.period_id
            WHERE p.period = :per AND NOT a.is_group GROUP BY p.entity_id, a.account_class""",
        per=period(),
    )
    sums: dict[tuple[str, str], Decimal] = {(str(r["entity_id"]), r["account_class"]): r["total"] for r in sums_rows}

    def s(eid: Any, cls: str) -> Decimal:
        return sums.get((str(eid), cls), ZERO)

    translation = []
    for e in active:
        ccy = e["functional_currency"].strip()
        assets, liabilities = s(e["id"], "asset"), s(e["id"], "liability")
        ni = s(e["id"], "revenue") - s(e["id"], "expense")
        equity = assets - liabilities
        cl, av = rate(ccy, "closing"), rate(ccy, "average")
        equity_usd = _r((equity - ni) * cl * Decimal("1.004") + ni * av, CENT)  # opening equity at historical (approximated)
        translation.append({
            "entityId": str(e["id"]), "entityName": e["name"], "ccy": ccy,
            "assets": num(_r(assets, CENT)), "liabilities": num(_r(liabilities, CENT)), "equity": num(_r(equity, CENT)), "netIncome": num(_r(ni, CENT)),
            "assetsUsd": num(_r(assets * cl, CENT)), "liabilitiesUsd": num(_r(liabilities * cl, CENT)), "equityUsd": num(equity_usd),
            "netIncomeUsd": num(_r(ni * av, CENT)), "cta": num(_r(assets * cl - liabilities * cl - equity_usd, CENT)),
        })

    matches = [_match_json(m) for m in await db.all(
        """SELECT m.*, d.status AS draft_status FROM consolidation.ic_matches m LEFT JOIN journals.je_drafts d ON d.id = m.true_up_draft_id
            WHERE m.period = :p ORDER BY m.from_amount_usd DESC, m.id""",
        p=period(),
    )]
    elims = await db.all("SELECT * FROM consolidation.eliminations WHERE period = :p ORDER BY amount DESC, id", p=period())
    elim_total = sum((x["amount"] for x in elims if x["status"] != "proposed"), ZERO)

    def cls_usd(e: dict[str, Any], cls: str, kind: str) -> Decimal:
        return s(e["id"], cls) * rate(e["functional_currency"].strip(), kind)

    line_defs: list[tuple[str, str, str, Any, Decimal]] = [
        ("REV", "Revenue", "pl", lambda e: cls_usd(e, "revenue", "average"), -elim_total * Decimal("0.3")),
        ("EXP", "Expenses", "pl", lambda e: cls_usd(e, "expense", "average"), -elim_total * Decimal("0.3")),
        ("NI", "Net income", "pl", lambda e: cls_usd(e, "revenue", "average") - cls_usd(e, "expense", "average"), ZERO),
        ("AST", "Total assets", "bs", lambda e: cls_usd(e, "asset", "closing"), -elim_total),
        ("LIA", "Total liabilities", "bs", lambda e: cls_usd(e, "liability", "closing"), -elim_total),
        ("EQ", "Total equity", "bs", lambda e: cls_usd(e, "asset", "closing") - cls_usd(e, "liability", "closing"), ZERO),
    ]
    statements = []
    for code, name, stmt, f, elim in line_defs:
        by_entity = {str(e["id"]): _r(f(e)) for e in active}
        total = sum(by_entity.values(), ZERO)
        statements.append({"code": code, "name": name, "statement": stmt, "byEntity": {k: int(v) for k, v in by_entity.items()},
                           "eliminations": int(_r(elim)), "consolidated": int(_r(total + elim))})

    ic_done = all(m["status"] in ("matched", "resolved", "pending_counterparty") for m in matches)
    elim_done = all(x["status"] != "proposed" for x in elims)
    locked_n = len([e for e in active if e["period_status"] == "locked"])
    all_locked = locked_n == len(active)
    mism = len([m for m in matches if m["status"] == "mismatch"])
    proposed = len([x for x in elims if x["status"] == "proposed"])
    tr, rv, st = cp["translation_run"], cp["reviewed"], cp["status"]
    return {
        "period": _per_key(),
        "status": st,
        "tolerance": {"absUsd": 500, "pct": 1},
        "steps": [
            {"key": "ic", "label": "Intercompany reconciled", "done": ic_done, "detail": "All matched or explained." if ic_done else f"{mism} mismatch(es) need a true-up."},
            {"key": "translation", "label": "Currency translation run", "done": tr, "detail": "Translated at Aug closing / average rates." if tr else "Run translation (ASC 830)."},
            {"key": "elims", "label": "Eliminations approved", "done": elim_done, "detail": "All eliminations approved." if elim_done else f"{proposed} awaiting approval."},
            {"key": "review", "label": "Consolidated review", "done": rv, "detail": "Reviewed." if rv else "Review consolidated statements."},
            {"key": "lock", "label": "Sign-off and lock", "done": st == "locked",
             "detail": ("Locked." if st == "locked" else "Ready to lock.") if all_locked else f"Every entity period must be locked first ({locked_n}/{len(active)} locked)."},
        ],
        "rates": [{"ccy": k, "closing": num(v.get("closing")), "average": num(v.get("average")), "source": v["source"]} for k, v in rates.items()],
        "translation": translation,
        "matches": matches,
        "eliminations": [_elim_json(x) for x in elims],
        "statements": statements,
        "entityIds": [str(e["id"]) for e in active],
    }


@router.get("/consolidation")
async def consolidation_view(request: Request) -> dict[str, Any]:
    async with session(request) as (_p, db):
        return await _consolidation_view(db)


@router.post("/consolidation/translation-run")
async def translation_run(request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        p.require("consolidation.manage")
        return await enqueue(db, "translation_run", {"period": _per_key()}, created_by=p.id, message="Loading closing and average rates")


@router.post("/ic-matches/{match_id}/true-up")
async def ic_true_up(match_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        m = await db.one("SELECT * FROM consolidation.ic_matches WHERE id = :id FOR UPDATE", id=_uuid(match_id))
        if not m:
            raise fail(404, "Match not found")
        if m["status"] != "mismatch":
            raise fail(409, "Not a mismatch")
        if m["true_up_draft_id"]:
            raise fail(409, "True-up already drafted")
        target = m["to_entity_id"]
        p.require("je.prepare", target)
        await assert_open(db, target)
        ent = await entity_or_404(db, target)
        frm = await entity_or_404(db, m["from_entity_id"])
        ccy = ent["functional_currency"].strip()
        rates = await _rates(db)
        rate = ONE if ccy == "USD" else rates.get(ccy, {}).get("closing")
        if not rate:
            raise fail(409, "No FX rate", f"There is no Aug closing rate for {ccy}.", "fx_rate_missing")
        amount = _r((m["from_amount_usd"] - m["to_amount_usd"]) / rate, CENT)
        if amount <= 0:
            raise fail(409, "Nothing to true up", "The counterparty side is not lower than the originating side.")
        label = f"{frm['name']} → {ent['name']}"
        ai_id = await gateway().record(db, AiResult(
            kind="ic_mismatch", text=m["explanation"], confidence=0.86, prompt_version="ic-mismatch@1", input_record_ids=[str(m["id"])],
            citations=[{"recordType": "ic_match", "recordId": str(m["id"]), "label": f"IC match {label}", "link": "/consolidation"}],
        ))
        exp = await _account(db, target, "61001002", "expense")
        ic = await _account(db, target, "23001000", "liability")
        d = await _new_draft(
            db, p, ent, je_type="correction", source_type="ic_true_up", source_ref_id=m["id"], source_label=f"IC true-up · {label}",
            description=f"Intercompany true-up ({m['likely_cause'] or 'amount'}) for {label}", ai_output_id=ai_id,
            lines=[(exp, amount, ZERO, "IC true-up"), (ic, ZERO, amount, "IC true-up")],
        )
        await db.exec("UPDATE consolidation.ic_matches SET true_up_draft_id = :d WHERE id = :id", d=d["id"], id=m["id"])
        await audit(db, "ic.true_up_drafted", "ic_match", m["id"], f"IC true-up {d['number']} drafted in {ent['name']} ({ccy} {float(amount):,.2f})", actor_id=p.id, entity_id=target)
        m2 = await db.one(
            "SELECT m.*, d.status AS draft_status FROM consolidation.ic_matches m LEFT JOIN journals.je_drafts d ON d.id = m.true_up_draft_id WHERE m.id = :id", id=m["id"]
        )
        assert m2
        return {"match": _match_json(m2), "draft": (await drafts_json(db, "d.id = :id", id=d["id"]))[0]}


@router.post("/eliminations/{elim_id}/approve")
async def approve_elimination(elim_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        p.require("consolidation.manage")
        e = await db.one("SELECT * FROM consolidation.eliminations WHERE id = :id FOR UPDATE", id=_uuid(elim_id))
        if not e:
            raise fail(404, "Elimination not found")
        if e["status"] != "proposed":
            raise fail(409, "Already approved")
        if e["prepared_by"] == p.id:
            raise fail(403, "Segregation of duties", "You prepared this elimination.", "sod_elimination")
        row = await db.update("consolidation.eliminations", {"id": e["id"]}, {"status": "posted", "approved_by": p.id})
        assert row
        await audit(db, "elimination.approved", "elimination", e["id"], f"{e['description']} ({_usd(e['amount'])}) approved and posted to the consolidation layer", actor_id=p.id)
        return _elim_json(row)


@router.post("/consolidation/review")
async def consolidation_review(request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        p.require("consolidation.manage")
        cp = await _cons_period(db)
        if not cp["translation_run"]:
            raise fail(409, "Run translation first")
        await db.exec("UPDATE consolidation.periods SET reviewed = true WHERE period = :p", p=period())
        await audit(db, "consolidation.reviewed", "consolidation", _per_key(), f"Consolidated statements reviewed by {p.name}", actor_id=p.id)
        return await _consolidation_view(db)


@router.post("/consolidation/lock")
async def consolidation_lock(request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        p.require("consolidation.manage")
        await _cons_period(db)
        view = await _consolidation_view(db)
        blocking = [s for s in view["steps"] if s["key"] != "lock" and not s["done"]]
        if blocking:
            raise fail(409, "Steps not complete", ", ".join(b["label"] for b in blocking) + " must be done first.")
        unlocked = await db.all(
            """SELECT e.name FROM tenancy.entities e LEFT JOIN close.periods p ON p.entity_id = e.id AND p.period = :per
                WHERE e.status = 'active' AND (p.status IS NULL OR p.status <> 'locked') ORDER BY e.parent_id NULLS FIRST, e.name""",
            per=period(),
        )
        if unlocked:
            raise fail(409, "Entity periods still open", f"Lock every entity first (CO-7): {', '.join(u['name'] for u in unlocked)}.", "entities_unlocked")
        await db.exec("UPDATE consolidation.periods SET status = 'locked', locked_by = :u, locked_at = now() WHERE period = :p", u=p.id, p=period())
        await audit(db, "consolidation.locked", "consolidation", _per_key(), f"Consolidated Aug 2026 signed off and locked by {p.name}", actor_id=p.id)
        return await _consolidation_view(db)
