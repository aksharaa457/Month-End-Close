"""Journal entries with human-in-the-loop approval (JE-1..JE-7). Posting runs in
the worker; the API only records approvals and enqueues posting jobs."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.core.audit import audit
from app.core.auth import session
from app.core.db import Db
from app.core.errors import fail
from app.core.permissions import Principal
from app.jobs.queue import enqueue
from app.services import journals as J
from app.services.common import assert_open, entity_or_404, period_row

router = APIRouter(prefix="/api/v1")
STATUSES = ["draft", "submitted", "approved", "rejected", "posting", "posted", "post_failed", "withdrawn"]


async def _one(db: Db, draft_id: Any) -> dict[str, Any]:
    return (await J.drafts_json(db, "d.id = :id", id=draft_id))[0]


@router.get("/entities/{entity_id}/periods/{per}/je-drafts")
async def list_drafts(entity_id: str, per: str, request: Request) -> dict[str, Any]:
    async with session(request) as (_p, db):
        e = await entity_or_404(db, entity_id)
        pr = await period_row(db, e["id"])
        drafts = await J.drafts_json(db, "d.period_id = :p", p=pr["id"])
        by = {s: {"count": 0, "total": 0.0} for s in STATUSES}
        for d in drafts:
            by[d["status"]]["count"] += 1
            by[d["status"]]["total"] = round(by[d["status"]]["total"] + d["totalDebit"], 2)
        live = [d for d in drafts if d["status"] not in ("withdrawn", "rejected")]
        return {
            "drafts": drafts,
            "summary": {"count": len(live), "total": round(sum(d["totalDebit"] for d in live), 2), "byStatus": by},
            "policy": J.policy_json(await J.policy_for(db, e["id"])),
        }


@router.get("/je-drafts/{draft_id}")
async def get_draft(draft_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (_p, db):
        d = await J.draft_or_404(db, draft_id)
        return await _one(db, d["id"])


@router.get("/entities/{entity_id}/periods/{per}/je-candidates")
async def candidates(entity_id: str, per: str, request: Request) -> list[dict[str, Any]]:
    async with session(request) as (_p, db):
        e = await entity_or_404(db, entity_id)
        pr = await period_row(db, e["id"])
        rows = await db.all(
            """SELECT v.account_id, v.needs_entry, a.erp_account_code, a.name FROM flux.variances v JOIN brain.accounts a ON a.id = v.account_id
                WHERE v.period_id = :p AND v.is_flagged AND NOT a.is_group AND v.needs_entry IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM journals.je_drafts d WHERE d.source_variance_id = v.id AND d.status <> 'withdrawn')""",
            p=pr["id"],
        )
        return [{"varianceId": str(r["account_id"]), "label": f"{r['erp_account_code']} {r['name']}", **r["needs_entry"]} for r in rows]


@router.post("/entities/{entity_id}/periods/{per}/je-drafts/generate")
async def generate(entity_id: str, per: str, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        e = await entity_or_404(db, entity_id)
        p.require("je.prepare", e["id"])
        await assert_open(db, e["id"])
        return await enqueue(db, "generate_drafts", {"entityId": str(e["id"])}, created_by=p.id, message="Reading flagged lines and explanations")


class ManualIn(BaseModel):
    type: Literal["correction", "reclass", "accrual"] = "correction"
    description: str = Field(default="Manual journal entry", min_length=3, max_length=500)


@router.post("/entities/{entity_id}/periods/{per}/je-drafts")
async def create_manual(entity_id: str, per: str, body: ManualIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        e = await entity_or_404(db, entity_id)
        p.require("je.prepare", e["id"])
        pr = await assert_open(db, e["id"])
        d = await db.insert("journals.je_drafts", {"number": await J.next_number(db), "period_id": pr["id"], "je_type": body.type, "source_type": "manual",
                                                   "description": body.description, "status": "draft", "created_by_ai": False, "preparer_id": p.id,
                                                   "currency": e["functional_currency"].strip()})
        await audit(db, "je_draft.created", "je_draft", d["id"], f"{d['number']} created manually", actor_id=p.id, entity_id=e["id"])
        return await _one(db, d["id"])


class LineIn(BaseModel):
    accountId: uuid.UUID
    debit: Decimal = Field(default=Decimal(0), ge=0, max_digits=20, decimal_places=4)
    credit: Decimal = Field(default=Decimal(0), ge=0, max_digits=20, decimal_places=4)
    memo: str = Field(default="", max_length=500)


class DraftPatch(BaseModel):
    version: int
    lines: list[LineIn] | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, min_length=3, max_length=500)
    type: Literal["correction", "reclass", "accrual"] | None = None


@router.patch("/je-drafts/{draft_id}")
async def edit_draft(draft_id: str, body: DraftPatch, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        d = await J.draft_or_404(db, draft_id)
        p.require("je.prepare", d["entity_id"])
        await assert_open(db, d["entity_id"])
        if d["status"] not in ("draft", "rejected"):
            raise fail(409, "Entry is locked", "Lines can't change once an entry is submitted (JE-6).", "lines_frozen")
        if body.version != d["version"]:
            raise fail(409, "Entry changed", f"Someone else saved v{d['version']}. Reload before editing.", "stale_version")
        # Back to 'draft' first: the freeze_lines trigger only allows line changes on drafts.
        await db.exec("UPDATE journals.je_drafts SET status = 'draft' WHERE id = :d", d=d["id"])
        if body.lines is not None:
            for i, ln in enumerate(body.lines, 1):
                ok = await db.scalar("SELECT count(*) FROM brain.accounts WHERE id = :a AND entity_id = :e AND NOT is_group", a=ln.accountId, e=d["entity_id"])
                if not ok:
                    raise fail(422, "Unknown account", f"Line {i}: choose a posting account.")
                if (ln.debit > 0) == (ln.credit > 0):
                    raise fail(422, "Invalid line", f"Line {i} must have either a debit or a credit.")
            await db.exec("DELETE FROM journals.je_lines WHERE draft_id = :d", d=d["id"])
            for i, ln in enumerate(body.lines, 1):
                await db.insert("journals.je_lines", {"draft_id": d["id"], "line_no": i, "account_id": ln.accountId, "debit": ln.debit, "credit": ln.credit, "memo": ln.memo}, returning="id")
        total = await db.scalar("SELECT coalesce(sum(debit), 0) FROM journals.je_lines WHERE draft_id = :d", d=d["id"])
        pol = await J.policy_for(db, d["entity_id"])
        await db.exec(
            """UPDATE journals.je_drafts SET description = coalesce(:desc, description), je_type = coalesce(:typ, je_type), preparer_id = :u,
                      version = version + 1, requires_second_approval = :two, approval_policy_id = :pol WHERE id = :d""",
            desc=body.description, typ=body.type, u=p.id, two=total > pol["second_approval_above"], pol=pol["id"], d=d["id"],
        )
        await audit(db, "je_draft.edited", "je_draft", d["id"], f"{d['number']} edited (v{d['version'] + 1}) by {p.name}", actor_id=p.id, entity_id=d["entity_id"])
        return await _one(db, d["id"])


class ActionIn(BaseModel):
    version: int | None = None
    comment: str | None = Field(default=None, max_length=2000)


@router.post("/je-drafts/{draft_id}/{action}")
async def draft_action(draft_id: str, action: Literal["submit", "approve", "reject", "withdraw", "retry-posting"], body: ActionIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        d = await J.draft_or_404(db, draft_id)
        await assert_open(db, d["entity_id"])
        await _act(db, p, d, action, body)
        return await _one(db, d["id"])


async def _act(db: Db, p: Principal, d: dict[str, Any], action: str, body: ActionIn) -> None:
    ent = d["entity_id"]
    if action == "submit":
        p.require("je.prepare", ent)
        if d["status"] not in ("draft", "rejected"):
            raise fail(409, "Can't submit", f"Entry is {d['status']}.")
        t = await db.one("SELECT count(*) AS n, coalesce(sum(debit), 0) AS dr, coalesce(sum(credit), 0) AS cr FROM journals.je_lines WHERE draft_id = :d", d=d["id"])
        assert t
        if t["n"] < 2:
            raise fail(422, "Needs at least 2 lines", None, "too_few_lines")
        if t["dr"] != t["cr"]:
            raise fail(422, "Entry doesn't balance", f"Debits {t['dr']:,.2f} ≠ credits {t['cr']:,.2f} (JE-6).", "unbalanced")
        if d["status"] == "rejected":
            await db.exec("UPDATE journals.je_drafts SET status = 'draft' WHERE id = :d", d=d["id"])
        await db.exec("UPDATE journals.je_drafts SET status = 'submitted', preparer_id = coalesce(preparer_id, :u) WHERE id = :d", u=p.id, d=d["id"])
        await audit(db, "je_draft.submitted", "je_draft", d["id"], f"{d['number']} submitted for approval by {p.name}", actor_id=p.id, entity_id=ent)
    elif action == "approve":
        version = body.version if body.version is not None else d["version"]
        await J.assert_can_approve(db, p, d, version)
        if await J.approve(db, p, d, comment=body.comment):
            await enqueue(db, "post_je", {"draftId": str(d["id"])}, created_by=p.id, message="Posting to ERP")
    elif action == "reject":
        p.require("je.approve", ent)
        if d["status"] != "submitted":
            raise fail(409, "Not awaiting approval")
        if d["preparer_id"] == p.id:
            raise fail(403, "Segregation of duties", "You can't decide on an entry you prepared.", "sod_preparer")
        reason = (body.comment or "").strip()
        if len(reason) < 3:
            raise fail(422, "Reason required", "Say why you're rejecting the entry.")
        lvl = await db.scalar("SELECT coalesce(max(level), 0) + 1 FROM journals.approvals WHERE draft_id = :d AND draft_version = :v", d=d["id"], v=d["version"])
        await db.insert("journals.approvals", {"draft_id": d["id"], "draft_version": d["version"], "level": min(int(lvl), 2), "approver_id": p.id, "decision": "rejected", "comment": reason}, returning="id")
        await db.exec("UPDATE journals.je_drafts SET status = 'rejected' WHERE id = :d", d=d["id"])
        await audit(db, "je_draft.rejected", "je_draft", d["id"], f"{d['number']} rejected: {reason}", actor_id=p.id, entity_id=ent)
    elif action == "withdraw":
        p.require("je.prepare", ent)
        if d["status"] not in ("draft", "rejected", "submitted"):
            raise fail(409, "Can't withdraw", f"Entry is {d['status']}.")
        await db.exec("UPDATE journals.je_drafts SET status = 'withdrawn' WHERE id = :d", d=d["id"])
        await audit(db, "je_draft.withdrawn", "je_draft", d["id"], f"{d['number']} withdrawn by {p.name}", actor_id=p.id, entity_id=ent)
    elif action == "retry-posting":
        if not (p.can("je.approve", ent) or p.can("je.prepare", ent)):
            raise fail(403, "Not allowed")
        if d["status"] != "post_failed":
            raise fail(409, "Nothing to retry")
        await db.exec("UPDATE journals.je_drafts SET status = 'approved' WHERE id = :d", d=d["id"])
        await enqueue(db, "post_je", {"draftId": str(d["id"])}, created_by=p.id, message="Retrying post (lookup by external id first)")
        await audit(db, "je_draft.post_retry", "je_draft", d["id"], f"{d['number']}: posting retry queued", actor_id=p.id, entity_id=ent)


class BatchItem(BaseModel):
    id: uuid.UUID
    version: int


class BatchIn(BaseModel):
    items: list[BatchItem] = Field(min_length=1, max_length=500)


@router.post("/je-batches/approve")
async def batch_approve(body: BatchIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        drafts = [(await J.draft_or_404(db, i.id), i.version) for i in body.items]
        for d, v in drafts:  # validate everything before changing anything
            await assert_open(db, d["entity_id"])
            await J.assert_can_approve(db, p, d, v)
        first = drafts[0][0]
        batch = await db.insert("journals.approval_batches", {"period_id": first["period_id"], "approver_id": p.id, "entry_count": len(drafts)})
        ready = []
        for d, _v in drafts:
            if await J.approve(db, p, d, batch_id=batch["id"]):
                ready.append(str(d["id"]))
        return await enqueue(db, "post_batch", {"draftIds": ready, "approved": len(drafts), "awaitingSecond": len(drafts) - len(ready)},
                             created_by=p.id, message="Queuing posting jobs")
