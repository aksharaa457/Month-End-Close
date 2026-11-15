"""Journal entries (JE-1..JE-7): shapes, numbering, SOD checks and ERP posting."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.connectors.base import connector_for
from app.core.audit import audit
from app.core.db import Arr, Db
from app.core.errors import fail
from app.core.permissions import Principal
from app.core.serialize import iso, num, sid
from app.services.common import ai_by_ids


async def policy_for(db: Db, entity_id: Any) -> dict[str, Any]:
    p = await db.one("SELECT * FROM journals.approval_policies WHERE entity_id = :e ORDER BY version DESC LIMIT 1", e=entity_id)
    assert p
    return p


def policy_json(p: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(p["id"]), "entityId": str(p["entity_id"]), "secondApprovalAbove": num(p["second_approval_above"]), "currency": p["currency"].strip(),
            "version": p["version"], "effectiveFrom": p["effective_from"].strftime("%Y-%m")}


async def next_number(db: Db) -> str:
    n = await db.scalar("SELECT coalesce(max(CAST(substring(number FROM 4) AS int)), 1000) + 1 FROM journals.je_drafts WHERE number ~ '^JE-[0-9]+$'")
    return f"JE-{n}"


async def drafts_json(db: Db, where: str, **params: Any) -> list[dict[str, Any]]:
    drafts = await db.all(
        f"""SELECT d.*, p.entity_id, v.account_id AS source_account_id FROM journals.je_drafts d
              JOIN close.periods p ON p.id = d.period_id LEFT JOIN flux.variances v ON v.id = d.source_variance_id
             WHERE {where} ORDER BY d.number DESC""",
        **params,
    )
    if not drafts:
        return []
    ids = Arr([d["id"] for d in drafts], "uuid[]")
    lines = await db.all(
        """SELECT l.*, a.erp_account_code, a.name AS account_name FROM journals.je_lines l JOIN brain.accounts a ON a.id = l.account_id
            WHERE l.draft_id = ANY(:ids) ORDER BY l.line_no""",
        ids=ids,
    )
    apprs = await db.all("SELECT * FROM journals.approvals WHERE draft_id = ANY(:ids) ORDER BY decided_at", ids=ids)
    posts = await db.all("SELECT * FROM journals.posting_attempts WHERE draft_id = ANY(:ids) ORDER BY attempt_no", ids=ids)
    ai = await ai_by_ids(db, [d["ai_output_id"] for d in drafts])
    out = []
    for d in drafts:
        k = d["id"]
        ls = [ln for ln in lines if ln["draft_id"] == k]
        out.append({
            "id": str(k), "number": d["number"], "entityId": str(d["entity_id"]), "periodId": str(d["period_id"]),
            "type": d["je_type"], "sourceType": d["source_type"],
            "sourceId": sid(d["source_account_id"] or d["source_ref_id"]), "sourceLabel": d["source_label"],
            "description": d["description"], "status": d["status"], "createdByAi": d["created_by_ai"],
            "aiOutput": ai.get(str(d["ai_output_id"])) if d["ai_output_id"] else None,
            "preparerId": sid(d["preparer_id"]), "currency": d["currency"].strip(),
            "lines": [
                {"id": str(ln["id"]), "lineNo": ln["line_no"], "accountId": str(ln["account_id"]), "accountCode": ln["erp_account_code"], "accountName": ln["account_name"],
                 "debit": num(ln["debit"]), "credit": num(ln["credit"]), "memo": ln["memo"] or ""}
                for ln in ls
            ],
            "totalDebit": num(sum((ln["debit"] for ln in ls), Decimal(0))),
            "totalCredit": num(sum((ln["credit"] for ln in ls), Decimal(0))),
            "requiresSecondApproval": d["requires_second_approval"], "version": d["version"],
            "approvals": [
                {"id": str(a["id"]), "level": a["level"], "approverId": str(a["approver_id"]), "decision": a["decision"], "draftVersion": a["draft_version"],
                 "comment": a["comment"], "decidedAt": iso(a["decided_at"]), "batchId": sid(a["batch_id"])}
                for a in apprs if a["draft_id"] == k
            ],
            "postingAttempts": [
                {"attemptNo": p["attempt_no"], "status": p["status"], "erpDocNumber": p["erp_doc_number"], "error": p["error_message"], "at": iso(p["started_at"])}
                for p in posts if p["draft_id"] == k
            ],
            "erpDocNumber": d["erp_doc_number"], "sourceChanged": d["source_changed"], "createdAt": iso(d["created_at"]),
        })
    return out


async def draft_or_404(db: Db, draft_id: Any) -> dict[str, Any]:
    try:
        d = await db.one("SELECT d.*, p.entity_id FROM journals.je_drafts d JOIN close.periods p ON p.id = d.period_id WHERE d.id = CAST(:id AS uuid)", id=str(draft_id))
    except Exception:  # noqa: BLE001
        d = None
    if not d:
        raise fail(404, "Entry not found")
    return d


async def assert_can_approve(db: Db, p: Principal, d: dict[str, Any], version: int) -> None:
    """Mirrors the database trigger journals.check_approval_sod, with friendlier messages."""
    p.require("je.approve", d["entity_id"])
    if d["status"] != "submitted":
        raise fail(409, "Not awaiting approval", f"This entry is {d['status'].replace('_', ' ')}.", "invalid_state")
    if version != d["version"]:
        raise fail(409, "Entry changed since you reviewed it", f"You reviewed v{version}; the entry is now v{d['version']}. Reload and review again.", "stale_version")
    if d["preparer_id"] == p.id:
        raise fail(403, "Segregation of duties", "You prepared or last edited this entry, so you can't approve it.", "sod_preparer")
    lvl1 = await db.one(
        "SELECT approver_id FROM journals.approvals WHERE draft_id = :d AND draft_version = :v AND level = 1 AND decision = 'approved'", d=d["id"], v=d["version"]
    )
    if lvl1 and lvl1["approver_id"] == p.id:
        raise fail(403, "Segregation of duties", "The second approval must come from a different person.", "sod_second_approver")


async def approve(db: Db, p: Principal, d: dict[str, Any], *, comment: str | None = None, batch_id: Any = None) -> bool:
    """Records one approval. Returns True when the entry is fully approved (ready to post)."""
    lvl1 = await db.one("SELECT 1 FROM journals.approvals WHERE draft_id = :d AND draft_version = :v AND level = 1 AND decision = 'approved'", d=d["id"], v=d["version"])
    level = 2 if lvl1 else 1
    await db.insert("journals.approvals", {"draft_id": d["id"], "draft_version": d["version"], "level": level, "approver_id": p.id, "decision": "approved", "comment": comment, "batch_id": batch_id}, returning="id")
    needed = 2 if d["requires_second_approval"] else 1
    have = await db.scalar("SELECT count(*) FROM journals.approvals WHERE draft_id = :d AND draft_version = :v AND decision = 'approved'", d=d["id"], v=d["version"])
    await audit(db, "je_draft.approved", "je_draft", d["id"], f"{d['number']} level {level} approval by {p.name}{' — awaiting second approver' if have < needed else ''}", actor_id=p.id, entity_id=d["entity_id"])
    if have >= needed:
        await db.exec("UPDATE journals.je_drafts SET status = 'approved' WHERE id = :d", d=d["id"])
        return True
    return False


async def post_draft(db: Db, draft_id: Any) -> dict[str, Any]:
    """Worker-only (app_worker owns posting_attempts). Idempotent by design (ARCH §7.3):
    the ERP external id is draft id + version; an unknown outcome is resolved by lookup."""
    d = await db.one("SELECT d.*, p.entity_id, p.status AS period_status FROM journals.je_drafts d JOIN close.periods p ON p.id = d.period_id WHERE d.id = :id FOR UPDATE OF d", id=draft_id)
    if not d:
        raise fail(404, "Entry not found")
    if d["status"] == "posted":
        return {"status": "posted", "erpDocNumber": d["erp_doc_number"]}
    if d["status"] not in ("approved", "posting", "post_failed"):
        raise fail(409, "Not approved", f"Entry {d['number']} is {d['status']}.")
    key = f"{d['id']}:v{d['version']}"
    attempt = int(await db.scalar("SELECT coalesce(max(attempt_no), 0) + 1 FROM journals.posting_attempts WHERE draft_id = :d", d=d["id"]))
    lines = await db.all("SELECT l.*, a.erp_account_code FROM journals.je_lines l JOIN brain.accounts a ON a.id = l.account_id WHERE draft_id = :d ORDER BY line_no", d=d["id"])
    conn = await db.one("SELECT * FROM brain.connections WHERE entity_id = :e", e=d["entity_id"])
    erp = connector_for(conn)
    await db.exec("UPDATE journals.je_drafts SET status = 'posting' WHERE id = :d", d=d["id"])
    att = await db.insert("journals.posting_attempts", {"draft_id": d["id"], "attempt_no": attempt, "idempotency_key": key, "request_hash": key.encode(), "status": "pending"})
    existing = await erp.find_by_external_id(key)  # resolve unknown outcomes first, never blind re-post
    try:
        doc = existing or await erp.post_journal(key, d, lines)
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        await db.exec("UPDATE journals.posting_attempts SET status = 'failed', error_message = :m, finished_at = now() WHERE id = :id", m=msg, id=att["id"])
        await db.exec("UPDATE journals.je_drafts SET status = 'post_failed' WHERE id = :d", d=d["id"])
        await audit(db, "je_draft.post_failed", "je_draft", d["id"], f"{d['number']}: ERP rejected the post — {msg}", entity_id=d["entity_id"], actor_type="system")
        return {"status": "post_failed", "error": msg}
    await db.exec("UPDATE journals.posting_attempts SET status = 'succeeded', erp_doc_number = :doc, finished_at = now() WHERE id = :id", doc=doc, id=att["id"])
    await db.exec("UPDATE journals.je_drafts SET status = 'posted', erp_doc_number = :doc, posted_at = now() WHERE id = :d", doc=doc, d=d["id"])
    await audit(db, "je_draft.posted", "je_draft", d["id"], f"{d['number']} posted to {erp.name} as {doc} (external id {key})", entity_id=d["entity_id"], actor_type="system")
    return {"status": "posted", "erpDocNumber": doc}
