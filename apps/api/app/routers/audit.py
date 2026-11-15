"""Audit trail (US-22, US-24): the hash-chained event log, chain verification,
exports and the end-to-end trace of a journal entry."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.core.auth import session
from app.core.db import Arr, Db
from app.core.errors import fail
from app.core.permissions import Principal
from app.core.serialize import iso, period_key, sid
from app.jobs.queue import enqueue
from app.services.common import entity_or_404, user_names
from app.services.journals import draft_or_404, drafts_json

router = APIRouter(prefix="/api/v1")


def _hex(v: Any) -> str | None:
    return None if v is None else bytes(v).hex()


def event_json(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(r["id"]),
        "occurredAt": iso(r["occurred_at"]),
        "actorType": r["actor_type"],
        "actorId": sid(r["actor_id"]),
        "action": r["action"],
        "subjectType": r["subject_type"],
        "subjectId": str(r["subject_id"]),
        "entityId": sid(r["entity_id"]),
        "summary": r["summary"],
        "requestId": r["request_id"] or "",
        "prevHash": _hex(r["prev_hash"]),
        "hash": _hex(r["hash"]),
    }


EVENT_COLS = "id, occurred_at, actor_type, actor_id, action, subject_type, subject_id, entity_id, summary, request_id, prev_hash, hash"


def _visible_entities(p: Principal) -> list[str] | None:
    """None = tenant-wide audit access; otherwise the entities the viewer may audit."""
    if "audit.view" in p.perms.get("*", set()):
        return None
    return [k for k, perms in p.perms.items() if k != "*" and "audit.view" in perms]


async def query_events(db: Db, *, entity_id: str | None = None, subject_id: str | None = None, q: str | None = None,
                       scope: list[str] | None = None, newest_first: bool = True, limit: int | None = 500) -> list[dict[str, Any]]:
    conds = ["true"]
    params: dict[str, Any] = {}
    if entity_id:
        conds.append("entity_id::text = :ent")
        params["ent"] = entity_id
    if subject_id:
        conds.append("subject_id::text = :subj")
        params["subj"] = subject_id
    if q:
        conds.append("position(lower(:q) in lower(action || ' ' || summary)) > 0")
        params["q"] = q
    if scope is not None:
        conds.append("entity_id = ANY(:scope)")
        params["scope"] = Arr(scope, "uuid[]")
    sql = f"SELECT {EVENT_COLS} FROM audit.events WHERE {' AND '.join(conds)} ORDER BY id {'DESC' if newest_first else 'ASC'}"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [event_json(r) for r in await db.all(sql, **params)]


@router.get("/audit/events")
async def list_events(request: Request, q: str = "", entityId: str | None = None, subjectId: str | None = None) -> list[dict[str, Any]]:
    async with session(request) as (p, db):
        p.require("audit.view")
        return await query_events(db, entity_id=entityId, subject_id=subjectId, q=q.strip() or None, scope=_visible_entities(p))


@router.get("/audit/verify")
async def verify_chain(request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        p.require("audit.view")
        # RLS limits this to the caller's tenant: one chain, ordered by id.
        count = int(await db.scalar("SELECT count(*) FROM audit.events"))
        broken = await db.scalar(
            """SELECT id FROM (SELECT id, prev_hash, lag(hash) OVER (ORDER BY id) AS expected, row_number() OVER (ORDER BY id) AS n
                                 FROM audit.events) x
                WHERE n > 1 AND prev_hash IS DISTINCT FROM expected ORDER BY id LIMIT 1"""
        )
        if broken is not None:
            return {"ok": False, "count": count, "brokenAt": int(broken)}
        return {"ok": True, "count": count}


class ExportIn(BaseModel):
    entityId: str | None = None


@router.post("/audit/exports")
async def export_events(request: Request, body: ExportIn | None = None) -> dict[str, Any]:
    async with session(request) as (p, db):
        p.require("audit.view")
        entity_id = None
        if body and body.entityId:
            entity_id = str((await entity_or_404(db, body.entityId))["id"])
            p.require("audit.view", entity_id)
        elif _visible_entities(p) is not None:
            raise fail(403, "Not allowed", "Your audit access is limited to specific entities. Choose an entity to export.", "forbidden")
        return await enqueue(db, "audit_export", {"entityId": entity_id}, created_by=p.id, message="Collecting events")


# ------------------------------------------------------------------ trace (US-24)
def _loc(v: Any) -> str:
    """JS Number.toLocaleString('en-US')."""
    if v is None:
        return "n/a"
    return f"{float(v):,.3f}".rstrip("0").rstrip(".")


@router.get("/trace/je_draft/{draft_id}")
async def trace_draft(draft_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        p.require("audit.view")
        d = await draft_or_404(db, draft_id)
        draft = (await drafts_json(db, "d.id = :id", id=d["id"]))[0]
        names = await user_names(db)

        def name(uid: Any) -> str:
            return names.get(str(uid), "Unknown user") if uid else "Unknown user"

        nodes: list[dict[str, Any]] = []
        for a in reversed(draft["postingAttempts"]):
            nodes.append({"kind": "posting", "id": f"{draft['id']}-p{a['attemptNo']}", "title": f"Posting attempt {a['attemptNo']}: {a['status']}",
                          "detail": f"ERP document {a['erpDocNumber']}" if a["erpDocNumber"] else (a["error"] or ""), "at": a["at"], "actor": "Worker (app_worker)"})
        for a in reversed(draft["approvals"]):
            extra = (" in a batch" if a["batchId"] else "") + (f' · "{a["comment"]}"' if a["comment"] else "")
            nodes.append({"kind": "approval", "id": a["id"], "title": f"Level {a['level']} {a['decision']}",
                          "detail": f"Approved version v{a['draftVersion']}{extra}", "at": a["decidedAt"], "actor": name(a["approverId"])})
        nodes.append({
            "kind": "draft", "id": draft["id"], "title": f"{draft['number']} · {draft['type']}",
            "detail": f"{draft['description']}. Debits {_loc(draft['totalDebit'])} = credits {_loc(draft['totalCredit'])}. Prepared by {name(draft['preparerId'])}.",
            "at": draft["createdAt"], "actor": ("AI draft, then " + name(draft["preparerId"])) if draft["createdByAi"] else name(draft["preparerId"]),
        })
        ai = draft["aiOutput"]
        if ai:
            conf = ai["confidence"] if ai["confidence"] is not None else "n/a"
            nodes.append({"kind": "ai_output", "id": ai["id"], "title": f"AI output · {ai['modelId']}",
                          "detail": f'Prompt {ai["promptVersion"]} · confidence {conf} · region {ai["inferenceRegion"]}. "{ai["text"]}"', "at": ai["createdAt"], "actor": "AI gateway"})
        if d["source_type"] == "variance" and d["source_variance_id"]:
            v = await db.one(
                """SELECT v.*, a.erp_account_code, a.name AS account_name, th.version AS threshold_version, o.citations
                     FROM flux.variances v JOIN brain.accounts a ON a.id = v.account_id
                     JOIN flux.thresholds th ON th.id = v.threshold_id
                     LEFT JOIN ai.ai_outputs o ON o.id = v.explanation_ai_output_id
                    WHERE v.id = :id""",
                id=d["source_variance_id"],
            )
            if v:
                pct = "n/a" if v["delta_pct"] is None else _loc(round(float(v["delta_pct"]), 1))
                nodes.append({"kind": "variance", "id": str(v["account_id"]), "title": f"Variance · {v['erp_account_code']} {v['account_name']}",
                              "detail": f"{_loc(v['prior_amount'])} → {_loc(v['current_amount'])} ({pct}%) · flagged by threshold v{v['threshold_version']}", "at": None, "actor": None})
                cits = [c for c in (v["citations"] or []) if c.get("recordType") == "gl_line"]
                ids = [c["recordId"] for c in cits if _is_uuid(c.get("recordId"))]
                lines = {str(g["id"]): g for g in await db.all("SELECT * FROM brain.gl_lines WHERE id = ANY(:ids)", ids=Arr(ids, "uuid[]"))} if ids else {}
                for c in cits:
                    g = lines.get(str(c.get("recordId")))
                    nodes.append({"kind": "gl_line", "id": str(c.get("recordId")), "title": f"GL line {g['erp_line_ref'] if g else c.get('recordId')}",
                                  "detail": f"{g['posting_date'].isoformat()} · {_loc(g['amount'])} · {g['memo'] or ''}" if g else c.get("label", ""), "at": None, "actor": None})
        run = await db.one(
            """SELECT r.*, c.erp_type FROM brain.sync_runs r JOIN brain.connections c ON c.id = r.connection_id
                WHERE c.entity_id = :e ORDER BY r.started_at DESC LIMIT 1""",
            e=d["entity_id"],
        )
        if run:
            lines_n = (run["stats"] or {}).get("lines", 0)
            nodes.append({"kind": "sync_run", "id": str(run["id"]), "title": f"Source data · sync {run['trigger']}",
                          "detail": f"{_loc(lines_n)} lines synced from {'SAP' if run['erp_type'] == 'sap' else 'NetSuite'}", "at": iso(run["finished_at"]), "actor": "Worker (app_worker)"})
        per = await db.scalar("SELECT period FROM close.periods WHERE id = :id", id=d["period_id"])
        return {"draft": draft, "nodes": nodes, "period": period_key(per)}


def _is_uuid(v: Any) -> bool:
    try:
        uuid.UUID(str(v))
        return True
    except ValueError:
        return False


__all__ = ["router", "event_json", "query_events"]
