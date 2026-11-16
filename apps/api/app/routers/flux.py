"""Flux & variance and AI context (FX-1..FX-8, PRD §10.2)."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.ai.gateway import AiResult, gateway
from app.core.audit import audit
from app.core.auth import session
from app.core.db import Db
from app.core.errors import fail
from app.core.permissions import Principal
from app.core.serialize import day, iso, num, sid
from app.services import flux as F
from app.services.common import assert_open, entity_or_404, period, period_row, prior_period

router = APIRouter(prefix="/api/v1")


def _uuid(v: str) -> str:
    try:
        return str(uuid.UUID(v))
    except ValueError:
        raise fail(404, "Not found") from None


async def _variance(db: Db, account_id: str) -> dict[str, Any]:
    """Variances are addressed by account id within the open period."""
    v = await db.one(
        """SELECT v.*, a.erp_account_code, a.name AS account_name, a.entity_id, a.is_group
             FROM flux.variances v JOIN brain.accounts a ON a.id = v.account_id JOIN close.periods p ON p.id = v.period_id
            WHERE v.account_id = :a AND p.period = :per""",
        a=_uuid(account_id), per=period(),
    )
    if not v:
        raise fail(404, "Variance not found")
    return v


async def _variance_out(db: Db, v: dict[str, Any]) -> dict[str, Any]:
    return next(x for x in await F.list_variances(db, v["entity_id"]) if x["id"] == str(v["account_id"]))


# ------------------------------------------------------------------ variances
@router.get("/entities/{entity_id}/periods/{per}/variances")
async def flux_view(entity_id: str, per: str, request: Request) -> dict[str, Any]:
    async with session(request) as (_p, db):
        e = await entity_or_404(db, entity_id)
        variances = await F.list_variances(db, e["id"])
        thr = (await F.thresholds(db, e["id"]))[None]
        flagged = [v for v in variances if v["isFlagged"]]
        return {
            "period": period().strftime("%Y-%m"),
            "priorPeriod": prior_period().strftime("%Y-%m"),
            "threshold": {"id": str(thr["id"]), "entityId": str(e["id"]), "accountClass": None, "absAmount": num(thr["abs_amount"]), "pct": num(thr["pct"]),
                          "version": thr["version"], "effectiveFrom": thr["effective_from"].strftime("%Y-%m"), "createdBy": str(thr["created_by"]), "createdAt": iso(thr["created_at"])},
            "variances": variances,
            "counts": {"flagged": len(flagged), "total": len(variances), "signedOff": len([v for v in flagged if v["status"] in ("signed_off", "exception")])},
        }


@router.get("/variances/{account_id}")
async def get_variance(account_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (_p, db):
        return await _variance_out(db, await _variance(db, account_id))


@router.get("/variances/{account_id}/lines")
async def variance_lines(account_id: str, request: Request) -> list[dict[str, Any]]:
    async with session(request) as (_p, db):
        v = await _variance(db, account_id)
        rows = await db.all(
            """WITH RECURSIVE tree AS (SELECT id FROM brain.accounts WHERE id = :a
                                       UNION ALL SELECT c.id FROM brain.accounts c JOIN tree t ON c.parent_account_id = t.id)
               SELECT g.* FROM brain.gl_lines g WHERE g.account_id IN (SELECT id FROM tree) ORDER BY g.posting_date DESC LIMIT 200""",
            a=v["account_id"],
        )
        return [{"id": str(g["id"]), "entityId": str(g["entity_id"]), "accountId": str(g["account_id"]), "ref": g["erp_line_ref"], "postingDate": day(g["posting_date"]), "amount": num(g["amount"]), "memo": g["memo"] or ""} for g in rows]


class SignOffIn(BaseModel):
    version: int | None = None
    manualExplanation: str | None = Field(default=None, max_length=4000)


@router.post("/variances/{account_id}/sign-off")
async def sign_off(account_id: str, body: SignOffIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        v = await _variance(db, account_id)
        p.require("task.signoff", v["entity_id"])
        await assert_open(db, v["entity_id"])
        if not v["is_flagged"]:
            raise fail(409, "Not flagged", "Only flagged lines need sign-off.")
        if v["status"] in ("signed_off", "exception"):
            raise fail(409, "Already signed off")
        if body.version is not None and body.version != v["version"]:
            raise fail(409, "Variance changed", "Reload to see the latest explanation.", "stale_version")
        manual = (body.manualExplanation or "").strip()
        if v["status"] == "needs_manual" and not manual:
            raise fail(422, "Explanation required", "This line has no usable AI explanation. Write a manual explanation before signing off (EC-8).", "manual_required")
        explanation_id = v["explanation_ai_output_id"]
        if manual:
            explanation_id = await gateway().record(db, AiResult(kind="variance_explanation", text=manual, model_id="manual", prompt_version="manual", region="n/a"))
        await db.exec(
            """UPDATE flux.variances SET status = 'signed_off', signed_off_by = :u, signed_off_at = now(), changed_after_signoff = false,
                      explanation_ai_output_id = :ex, version = version + 1 WHERE id = :id""",
            u=p.id, ex=explanation_id, id=v["id"],
        )
        await audit(db, "variance.signed_off", "variance", v["account_id"], f"{v['erp_account_code']} {v['account_name']} signed off", actor_id=p.id, entity_id=v["entity_id"])
        return await _variance_out(db, v)


class ReasonIn(BaseModel):
    reason: str = Field(default="", max_length=2000)


@router.post("/variances/{account_id}/exception")
async def exception(account_id: str, body: ReasonIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        v = await _variance(db, account_id)
        p.require("task.signoff", v["entity_id"])
        await assert_open(db, v["entity_id"])
        if not v["is_flagged"]:
            raise fail(409, "Not flagged")
        reason = body.reason.strip()
        if len(reason) < 10:
            raise fail(422, "Reason required", "Describe the exception (at least 10 characters).")
        await db.exec(
            "UPDATE flux.variances SET status = 'exception', exception_reason = :r, signed_off_by = :u, signed_off_at = now(), version = version + 1 WHERE id = :id",
            r=reason, u=p.id, id=v["id"],
        )
        await audit(db, "variance.exception_approved", "variance", v["account_id"], f"{v['erp_account_code']} {v['account_name']}: approved exception — {reason}", actor_id=p.id, entity_id=v["entity_id"])
        return await _variance_out(db, v)


@router.post("/variances/{account_id}/reopen")
async def reopen_variance(account_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        v = await _variance(db, account_id)
        p.require("task.signoff", v["entity_id"])
        await assert_open(db, v["entity_id"])
        ok = v["explanation_ai_output_id"] and await db.scalar("SELECT outcome = 'ok' FROM ai.ai_outputs WHERE id = :a", a=v["explanation_ai_output_id"])
        await db.exec(
            "UPDATE flux.variances SET status = :s, signed_off_by = NULL, signed_off_at = NULL, exception_reason = NULL, version = version + 1 WHERE id = :id",
            s="open" if ok else "needs_manual", id=v["id"],
        )
        await audit(db, "variance.reopened", "variance", v["account_id"], f"{v['erp_account_code']} {v['account_name']} sign-off withdrawn", actor_id=p.id, entity_id=v["entity_id"])
        return await _variance_out(db, v)


# ------------------------------------------------------------------ AI context (FX-5, FX-6, §10.2)
async def _note_json(db: Db, n: dict[str, Any]) -> dict[str, Any]:
    links = await db.all(
        "SELECT DISTINCT v.account_id FROM flux.variance_context_links l JOIN flux.variances v ON v.id = l.variance_id WHERE l.context_note_id = :n", n=n["id"]
    )
    a = await db.one("SELECT erp_account_code, name FROM brain.accounts WHERE id = :a", a=n["account_id"]) if n["account_id"] else None
    return {
        "id": str(n["id"]), "scope": n["scope"], "entityId": sid(n["entity_id"]), "accountId": sid(n["account_id"]),
        "accountLabel": f"{a['erp_account_code']} · {a['name']}" if a else "All entities",
        "text": n["text"], "status": n["status"], "proposedBy": str(n["proposed_by"]), "proposedAt": iso(n["proposed_at"]),
        "decidedBy": sid(n["decided_by"]), "decidedAt": iso(n["decided_at"]), "reviewBy": day(n["review_by"]),
        "changesMaterialConclusion": n["changes_material_conclusion"], "version": n["version"],
        "appliedToVarianceIds": [str(x["account_id"]) for x in links], "previewExplanation": n["preview_explanation"],
        "decisionReason": n["decision_reason"], "retiredBy": sid(n["retired_by"]),
    }


async def _explain(db: Db, v: dict[str, Any], notes: list[dict[str, Any]], *, preview: bool) -> tuple[Any, AiResult]:
    ctx = await F.variance_context(db, v["entity_id"], v["account_id"])
    res = await gateway().explain_variance(ctx, notes, preview=preview)
    return await gateway().record(db, res), res


class NoteIn(BaseModel):
    text: str = Field(min_length=3, max_length=2000)
    scope: Literal["account", "account_group", "cross_entity"] = "account"
    reviewBy: dt.date | None = None
    noExpiry: bool = False


@router.post("/variances/{account_id}/context-notes")
async def propose_note(account_id: str, body: NoteIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        v = await _variance(db, account_id)
        p.require("context.propose", v["entity_id"])
        thr = (await F.thresholds(db, v["entity_id"]))[None]
        acct = await db.one("SELECT std_account_id FROM brain.accounts WHERE id = :a", a=v["account_id"])
        cross = body.scope == "cross_entity"
        if cross and not (acct and acct["std_account_id"]):
            raise fail(422, "Not mappable", "Cross-entity context needs the account to be mapped to the standard chart.")
        note_id = uuid.uuid4()
        preview_id, res = await _explain(db, v, [{"id": note_id, "text": body.text.strip()}], preview=True)
        n = await db.insert("flux.context_notes", {
            "id": note_id, "scope": body.scope, "entity_id": None if cross else v["entity_id"], "account_id": None if cross else v["account_id"],
            "std_account_id": acct["std_account_id"] if cross and acct else None, "text": body.text.strip(), "proposed_by": p.id,
            "review_by": None if body.noExpiry else (body.reviewBy or dt.date(2027, 9, 1)),
            "changes_material_conclusion": bool(v["is_flagged"] and abs(v["delta"]) > thr["abs_amount"]),
            "preview_explanation": res.text,
        })
        if cross:  # remember which line it was proposed from, for previews and links
            await db.exec("UPDATE flux.context_notes SET account_id = NULL WHERE id = :id", id=note_id)
        _ = preview_id
        await audit(db, "context_note.proposed", "context_note", note_id, f'AI context proposed on {v["erp_account_code"]} {v["account_name"]}: "{body.text.strip()}"', actor_id=p.id, entity_id=v["entity_id"])
        return await _note_json(db, n)


@router.get("/context-notes")
async def list_notes(request: Request, status: str | None = None, accountId: str | None = None, entityId: str | None = None) -> list[dict[str, Any]]:
    async with session(request) as (_p, db):
        conds, params = ["true"], {}
        if status:
            conds.append("status = :s")
            params["s"] = status
        if accountId:
            conds.append("account_id = :a")
            params["a"] = _uuid(accountId)
        if entityId:
            conds.append("(entity_id = :e OR entity_id IS NULL)")
            params["e"] = _uuid(entityId)
        rows = await db.all(f"SELECT * FROM flux.context_notes WHERE {' AND '.join(conds)} ORDER BY proposed_at DESC", **params)
        return [await _note_json(db, n) for n in rows]


class NoteEdit(BaseModel):
    text: str = Field(min_length=3, max_length=2000)
    reviewBy: dt.date | None = None
    version: int | None = None


@router.patch("/context-notes/{note_id}")
async def edit_note(note_id: str, body: NoteEdit, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        n = await db.one("SELECT * FROM flux.context_notes WHERE id = :id", id=_uuid(note_id))
        if not n:
            raise fail(404, "Context note not found")
        p.require("context.propose", n["entity_id"])
        if n["status"] not in ("pending", "approved"):
            raise fail(409, "Can't edit", "Only pending or approved context can be edited.")
        if body.version is not None and body.version != n["version"]:
            raise fail(409, "Context changed", "Someone else edited this note. Reload first.", "stale_version")
        was_approved = n["status"] == "approved"
        preview = None
        if n["account_id"]:
            v = await _variance(db, str(n["account_id"]))
            _, res = await _explain(db, v, [{"id": n["id"], "text": body.text.strip()}], preview=True)
            preview = res.text
            if was_approved:
                await db.exec("UPDATE flux.variances SET status = 'open' WHERE id = :id AND status = 'explained'", id=v["id"])
        await db.exec(
            """UPDATE flux.context_notes SET text = :t, review_by = :rb, version = version + 1, status = 'pending', proposed_by = :u, proposed_at = now(),
                      decided_by = NULL, decided_at = NULL, preview_explanation = :pv WHERE id = :id""",
            t=body.text.strip(), rb=body.reviewBy, u=p.id, pv=preview, id=n["id"],
        )
        await audit(db, "context_note.edited", "context_note", n["id"], f'AI context edited to v{n["version"] + 1}{" (was approved — no longer applied until re-approved)" if was_approved else ""}: "{body.text.strip()}"', actor_id=p.id, entity_id=n["entity_id"])  # noqa: E501
        return await _note_json(db, await db.one("SELECT * FROM flux.context_notes WHERE id = :id", id=n["id"]))  # type: ignore[arg-type]


@router.post("/context-notes/{note_id}/{decision}")
async def decide_note(note_id: str, decision: Literal["approve", "reject", "retire"], body: ReasonIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        n = await db.one("SELECT * FROM flux.context_notes WHERE id = :id", id=_uuid(note_id))
        if not n:
            raise fail(404, "Context note not found")
        await _decide(db, p, n, decision, body.reason.strip())
        return await _note_json(db, await db.one("SELECT * FROM flux.context_notes WHERE id = :id", id=n["id"]))  # type: ignore[arg-type]


async def _decide(db: Db, p: Principal, n: dict[str, Any], decision: str, reason: str) -> None:
    broad = n["scope"] != "account" or n["changes_material_conclusion"] or n["review_by"] is None
    if decision == "retire":
        if not (p.can("context.approve.broad", n["entity_id"]) or p.can("context.approve.account", n["entity_id"])):
            raise fail(403, "Not allowed")
        if n["status"] != "approved":
            raise fail(409, "Only approved context can be retired")
        await db.exec("UPDATE flux.context_notes SET status = 'retired', retired_by = :u WHERE id = :id", u=p.id, id=n["id"])
        if n["account_id"]:
            await db.exec(
                """UPDATE flux.variances SET status = 'open' WHERE account_id = :a AND status = 'explained'
                     AND period_id IN (SELECT id FROM close.periods WHERE period = :per)""",
                a=n["account_id"], per=period(),
            )
        await audit(db, "context_note.retired", "context_note", n["id"], f'AI context retired: "{n["text"]}"', actor_id=p.id, entity_id=n["entity_id"])
        return
    if n["status"] != "pending":
        raise fail(409, "Already decided")
    if n["proposed_by"] == p.id:
        raise fail(403, "Segregation of duties", "You proposed this context, so someone else must approve it (§10.2).", "sod_context")
    if broad:
        p.require("context.approve.broad", n["entity_id"])
    elif not p.can("context.approve.account", n["entity_id"]):
        raise fail(403, "Not allowed", "Only the account owner/reviewer or a Controller can approve context.")
    if decision == "reject":
        await db.exec("UPDATE flux.context_notes SET status = 'rejected', decided_by = :u, decided_at = now(), decision_reason = :r WHERE id = :id", u=p.id, r=reason or None, id=n["id"])
        await audit(db, "context_note.rejected", "context_note", n["id"], f"AI context rejected{': ' + reason if reason else ''}", actor_id=p.id, entity_id=n["entity_id"])
        return
    await db.exec("UPDATE flux.context_notes SET status = 'approved', decided_by = :u, decided_at = now() WHERE id = :id", u=p.id, id=n["id"])
    if n["account_id"]:
        v = await _variance(db, str(n["account_id"]))
        notes = await F.approved_notes(db, n["account_id"])
        ai_id, _res = await _explain(db, v, notes, preview=False)
        signed = v["status"] in ("signed_off", "exception")
        await db.exec(
            """UPDATE flux.variances SET explanation_ai_output_id = :ai, version = version + 1,
                      status = CASE WHEN :signed THEN status WHEN is_flagged THEN 'explained' ELSE status END,
                      changed_after_signoff = CASE WHEN :signed THEN true ELSE changed_after_signoff END
                WHERE id = :id""",
            ai=ai_id, signed=signed, id=v["id"],
        )
        for note in notes:
            await db.exec(
                "INSERT INTO flux.variance_context_links (tenant_id, variance_id, context_note_id, ai_output_id) VALUES (:t, :v, :n, :ai) ON CONFLICT DO NOTHING",
                t=db.tenant_id, v=v["id"], n=note["id"], ai=ai_id,
            )
    await audit(db, "context_note.approved", "context_note", n["id"], f"AI context approved by {p.name}; explanation regenerated", actor_id=p.id, entity_id=n["entity_id"])


__all__ = ["router", "period_row"]
