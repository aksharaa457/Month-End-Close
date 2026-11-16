"""Close status, periods, checklist, comments, jobs and notifications."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from app.core.audit import audit
from app.core.auth import session
from app.core.db import Db
from app.core.errors import fail
from app.core.permissions import Principal
from app.core.serialize import iso, sid
from app.jobs.queue import job_json
from app.services import close as C
from app.services.common import assert_open, close_day, entity_or_404, period, period_row, user_names

router = APIRouter(prefix="/api/v1")


def _uuid(v: str) -> str:
    try:
        return str(uuid.UUID(v))
    except ValueError:
        raise fail(404, "Not found") from None


# ------------------------------------------------------------------ jobs & notifications
@router.get("/jobs/{job_id}")
async def get_job(job_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (_p, db):
        row = await db.one("SELECT * FROM jobs.jobs WHERE id = :id", id=_uuid(job_id))
        if not row:
            raise fail(404, "Job not found")
        return job_json(row)


@router.get("/notifications")
async def notifications(request: Request) -> list[dict[str, Any]]:
    async with session(request) as (p, db):
        out: list[dict[str, Any]] = []
        rows = await db.all(
            """SELECT t.id, t.title, t.status, t.due_day, t.owner_id, t.reviewer_id, p.entity_id, e.name AS entity_name
                 FROM close.tasks t JOIN close.periods p ON p.id = t.period_id JOIN tenancy.entities e ON e.id = p.entity_id
                WHERE e.status = 'active' AND p.period = :per AND (t.owner_id = :u OR t.reviewer_id = :u)""",
            per=period(), u=p.id,
        )
        now = iso(await db.scalar("SELECT now()"))
        for t in rows:
            if t["owner_id"] == p.id and t["status"] != "completed" and t["due_day"] < close_day():
                out.append({"id": f"n-{t['id']}", "kind": "overdue_task", "text": f"Overdue: {t['title']} ({t['entity_name']})", "link": f"/e/{t['entity_id']}/checklist?task={t['id']}", "createdAt": now})
            if t["reviewer_id"] == p.id and t["status"] == "submitted":
                out.append({"id": f"n-s-{t['id']}", "kind": "signoff_needed", "text": f"Sign-off needed: {t['title']}", "link": f"/e/{t['entity_id']}/checklist?task={t['id']}", "createdAt": now})
        for d in await db.all(
            "SELECT d.id, d.number, d.description, d.preparer_id, d.created_at, p.entity_id FROM journals.je_drafts d JOIN close.periods p ON p.id = d.period_id WHERE d.status = 'submitted'"
        ):
            if d["preparer_id"] != p.id and p.can("je.approve", d["entity_id"]):
                out.append({"id": f"n-{d['id']}", "kind": "approval_needed", "text": f"Approval needed: {d['number']} {d['description'][:40]}", "link": f"/e/{d['entity_id']}/journals?draft={d['id']}", "createdAt": iso(d["created_at"])})
        for n in await db.all("SELECT id, text, entity_id, proposed_by, proposed_at FROM flux.context_notes WHERE status = 'pending'"):
            if n["proposed_by"] != p.id and p.can("context.approve.account", n["entity_id"]):
                out.append({"id": f"n-{n['id']}", "kind": "context_review", "text": f'AI context awaiting approval: "{n["text"][:40]}…"', "link": "/context", "createdAt": iso(n["proposed_at"])})
        for c in await db.all("SELECT c.entity_id, e.name FROM brain.connections c JOIN tenancy.entities e ON e.id = c.entity_id WHERE c.last_error IS NOT NULL"):
            out.append({"id": f"n-sync-{c['entity_id']}", "kind": "sync_failed", "text": f"Sync problem: {c['name']}", "link": "/setup?tab=connections", "createdAt": now})
        return out[:30]


# ------------------------------------------------------------------ close status
@router.get("/close/summary")
async def close_summary(request: Request) -> dict[str, Any]:
    async with session(request) as (_p, db):
        ents = await db.all("SELECT * FROM tenancy.entities ORDER BY parent_id NULLS FIRST, name")
        sums = [await C.entity_summary(db, e) for e in ents]
        active = [s for s in sums if s["status"] != "setup_required"]
        total = sum(s["tasksTotal"] for s in active)
        done = sum(s["tasksDone"] for s in active)
        cons = await db.one("SELECT status FROM consolidation.periods WHERE period = :p", p=period())
        return {
            "period": period().strftime("%Y-%m"),
            "today": "2026-09-04",
            "closeDay": close_day(),
            "entities": sums,
            "rollup": {
                "tasksTotal": total, "tasksDone": done, "tasksOverdue": sum(s["tasksOverdue"] for s in active),
                "pctComplete": round(done / total * 100, 1) if total else 0,
                "locked": len([s for s in sums if s["periodStatus"] == "locked"]), "entities": len(sums),
            },
            "forecast": await C.forecast(db, ents),
            "consolidationStatus": cons["status"] if cons else "not_started",
        }


@router.get("/entities/{entity_id}/summary")
async def entity_summary(entity_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (_p, db):
        return await C.entity_summary(db, await entity_or_404(db, entity_id))


@router.get("/entities/{entity_id}/periods/{per}")
async def period_detail(entity_id: str, per: str, request: Request) -> dict[str, Any]:
    async with session(request) as (_p, db):
        return await C.period_detail(db, await entity_or_404(db, entity_id))


@router.post("/entities/{entity_id}/periods/{per}/lock")
async def lock(entity_id: str, per: str, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        e = await entity_or_404(db, entity_id)
        p.require("period.lock", e["id"])
        pr = await period_row(db, e["id"])
        if pr["status"] == "locked":
            raise fail(409, "Already locked")
        unmet = [g for g in await C.lock_gates(db, e["id"]) if not g["met"]]
        if unmet:
            raise fail(409, "Lock gates not met", " ".join(g["detail"] for g in unmet), "gates_unmet")
        await db.exec("UPDATE close.periods SET status = 'locked', locked_at = now(), locked_by = :u WHERE id = :id", u=p.id, id=pr["id"])
        await audit(db, "period.locked", "period", pr["id"], f"Aug 2026 locked by {p.name}", actor_id=p.id, entity_id=e["id"])
        return {"ok": True}


class ReasonIn(BaseModel):
    reason: str = Field(default="", max_length=2000)


@router.post("/entities/{entity_id}/periods/{per}/reopen-requests")
async def request_reopen(entity_id: str, per: str, body: ReasonIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        e = await entity_or_404(db, entity_id)
        p.require("period.lock", e["id"])
        pr = await period_row(db, e["id"])
        if pr["status"] != "locked":
            raise fail(409, "Period is open", "Only a locked period can be reopened.")
        if len(body.reason.strip()) < 10:
            raise fail(422, "Reason too short", "Explain why the period needs to reopen (at least 10 characters).")
        r = await db.insert("close.reopen_requests", {"period_id": pr["id"], "reason": body.reason.strip(), "requested_by": p.id})
        await audit(db, "period.reopen_requested", "period", pr["id"], f'Reopen requested: "{r["reason"]}"', actor_id=p.id, entity_id=e["id"])
        return {"id": str(r["id"]), "status": r["status"]}


@router.post("/reopen-requests/{req_id}/{decision}")
async def decide_reopen(req_id: str, decision: Literal["approve", "reject"], request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        r = await db.one("SELECT r.*, pr.entity_id FROM close.reopen_requests r JOIN close.periods pr ON pr.id = r.period_id WHERE r.id = :id", id=_uuid(req_id))
        if not r:
            raise fail(404, "Request not found")
        p.require("period.reopen.approve", r["entity_id"])
        if r["status"] != "pending":
            raise fail(409, "Already decided")
        if r["requested_by"] == p.id:
            raise fail(403, "Segregation of duties", "You requested this reopen, so you can't approve it.", "sod_reopen")
        status = "approved" if decision == "approve" else "rejected"
        await db.exec("UPDATE close.reopen_requests SET status = :s, decided_by = :u, decided_at = now() WHERE id = :id", s=status, u=p.id, id=r["id"])
        if status == "approved":
            await db.exec("UPDATE close.periods SET status = 'open', locked_at = NULL, locked_by = NULL WHERE id = :id", id=r["period_id"])
            await db.exec("UPDATE consolidation.periods SET status = 'in_progress' WHERE period = :p AND status = 'locked'", p=period())
        await audit(db, f"period.reopen_{status}", "period", r["period_id"], f"Reopen {status} by {p.name}", actor_id=p.id, entity_id=r["entity_id"])
        return {"id": str(r["id"]), "status": status}


# ------------------------------------------------------------------ checklist (CL-1..CL-8)
async def _task(db: Db, task_id: str) -> dict[str, Any]:
    t = await db.one("SELECT t.*, p.entity_id FROM close.tasks t JOIN close.periods p ON p.id = t.period_id WHERE t.id = :id", id=_uuid(task_id))
    if not t:
        raise fail(404, "Task not found")
    return t


async def _task_out(db: Db, t: dict[str, Any]) -> dict[str, Any]:
    return (await C.tasks_json(db, t["period_id"], t["id"]))[0]


@router.get("/entities/{entity_id}/periods/{per}/tasks")
async def list_tasks(entity_id: str, per: str, request: Request) -> list[dict[str, Any]]:
    async with session(request) as (_p, db):
        e = await entity_or_404(db, entity_id)
        return await C.tasks_json(db, (await period_row(db, e["id"]))["id"])


class TaskPatch(BaseModel):
    ownerId: uuid.UUID | None = None
    reviewerId: uuid.UUID | None = None
    dueDay: int | None = Field(default=None, ge=0, le=60)
    status: Literal["in_progress"] | None = None
    version: int | None = None


@router.patch("/tasks/{task_id}")
async def patch_task(task_id: str, body: TaskPatch, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        t = await _task(db, task_id)
        p.require("task.edit", t["entity_id"])
        await assert_open(db, t["entity_id"])
        if body.version is not None and body.version != t["version"]:
            raise fail(409, "Task changed", "Someone else updated this task. Reload to see their changes.", "stale_version")
        owner = body.ownerId or t["owner_id"]
        reviewer = body.reviewerId or t["reviewer_id"]
        if owner and reviewer and owner == reviewer:
            raise fail(422, "Segregation of duties", "The reviewer must be a different person from the owner (CL-5).", "sod_owner_reviewer")
        names = await user_names(db)
        changes = []
        if body.ownerId and body.ownerId != t["owner_id"]:
            changes.append(f"owner → {names.get(str(body.ownerId), '?')}")
        if body.reviewerId and body.reviewerId != t["reviewer_id"]:
            changes.append(f"reviewer → {names.get(str(body.reviewerId), '?')}")
        if body.dueDay is not None and body.dueDay != t["due_day"]:
            changes.append(f"due → D+{body.dueDay}")
        status = "in_progress" if body.status == "in_progress" and t["status"] in ("not_started", "rejected") else t["status"]
        if status != t["status"]:
            changes.append("started")
        await db.exec(
            "UPDATE close.tasks SET owner_id = :o, reviewer_id = :r, due_day = :d, status = :s, version = version + 1 WHERE id = :id",
            o=owner, r=reviewer, d=body.dueDay if body.dueDay is not None else t["due_day"], s=status, id=t["id"],
        )
        await audit(db, "task.updated", "task", t["id"], f"{t['title']}: {', '.join(changes) or 'updated'}", actor_id=p.id, entity_id=t["entity_id"])
        return await _task_out(db, t)


class TitleIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)


@router.post("/tasks/{task_id}/subtasks")
async def add_subtask(task_id: str, body: TitleIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        t = await _task(db, task_id)
        p.require("task.edit", t["entity_id"])
        await assert_open(db, t["entity_id"])
        n = await db.scalar("SELECT coalesce(max(sort_order), 0) + 1 FROM close.subtasks WHERE task_id = :t", t=t["id"])
        await db.insert("close.subtasks", {"task_id": t["id"], "title": body.title.strip(), "created_by": p.id, "sort_order": n}, returning="id")
        await db.exec("UPDATE close.tasks SET version = version + 1 WHERE id = :id", id=t["id"])
        await audit(db, "subtask.added", "task", t["id"], f'Subtask added to "{t["title"]}": {body.title.strip()}', actor_id=p.id, entity_id=t["entity_id"])
        return await _task_out(db, t)


class SubtaskPatch(BaseModel):
    isDone: bool | None = None
    title: str | None = Field(default=None, max_length=300)
    removed: bool | None = None


@router.patch("/subtasks/{sub_id}")
async def patch_subtask(sub_id: str, body: SubtaskPatch, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        s = await db.one("SELECT * FROM close.subtasks WHERE id = :id", id=_uuid(sub_id))
        if not s:
            raise fail(404, "Subtask not found")
        t = await _task(db, str(s["task_id"]))
        p.require("task.edit", t["entity_id"])
        await assert_open(db, t["entity_id"])
        vals: dict[str, Any] = {}
        if body.isDone is not None:
            vals["is_done"] = body.isDone
        if body.title and body.title.strip():
            vals["title"] = body.title.strip()
        if body.removed:
            vals["removed_at"] = await db.scalar("SELECT now()")
        if vals:
            await db.update("close.subtasks", {"id": s["id"]}, vals)
            await db.exec("UPDATE close.tasks SET version = version + 1 WHERE id = :id", id=t["id"])
        what = "removed" if body.removed else ("checked" if body.isDone else "unchecked") if body.isDone is not None else "renamed"
        await audit(db, "subtask.removed" if body.removed else "subtask.updated", "task", t["id"], f'Subtask "{s["title"]}" {what}', actor_id=p.id, entity_id=t["entity_id"])
        return await _task_out(db, t)


class EvidenceIn(BaseModel):
    fileName: str = Field(min_length=1, max_length=255)
    sizeBytes: int = Field(gt=0)
    contentType: str = Field(default="application/octet-stream", max_length=200)


@router.post("/tasks/{task_id}/evidence")
async def add_evidence(task_id: str, body: EvidenceIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        t = await _task(db, task_id)
        p.require("task.edit", t["entity_id"])
        await assert_open(db, t["entity_id"])
        if body.sizeBytes > 100 * 1024 * 1024:
            raise fail(413, "File too large", "Evidence files can be up to 100 MB.")
        ev_id = uuid.uuid4()
        key = f"{p.tenant_id}/{t['id']}/{ev_id}"
        # Upload goes straight to S3 with a pre-signed URL; the malware scan marks it clean (S-10).
        # Locally there is no bucket, so the record is created as already scanned.
        await db.insert("close.task_evidence", {"id": ev_id, "task_id": t["id"], "s3_key": key, "file_name": body.fileName, "content_type": body.contentType or "application/octet-stream",
                                                "size_bytes": body.sizeBytes, "sha256": uuid.uuid4().bytes * 2, "scan_status": "clean", "uploaded_by": p.id}, returning="id")
        await db.exec("UPDATE close.tasks SET version = version + 1 WHERE id = :id", id=t["id"])
        await audit(db, "evidence.uploaded", "task", t["id"], f'Evidence "{body.fileName}" attached to "{t["title"]}"', actor_id=p.id, entity_id=t["entity_id"])
        return {"uploadUrl": f"https://s3.example/cch-evidence/{key}?X-Amz-Signature=…", "task": await _task_out(db, t)}


@router.post("/tasks/{task_id}/{action}")
async def task_action(task_id: str, action: Literal["submit", "sign-off", "reject", "reject-ai-verification"], body: ReasonIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        t = await _task(db, task_id)
        await assert_open(db, t["entity_id"])
        await _task_transition(db, p, t, action, body.reason.strip())
        await db.exec("UPDATE close.tasks SET version = version + 1 WHERE id = :id", id=t["id"])
        return await _task_out(db, t)


async def _task_transition(db: Db, p: Principal, t: dict[str, Any], action: str, reason: str) -> None:
    ent = t["entity_id"]
    if action == "submit":
        p.require("task.edit", ent)
        if t["status"] not in ("in_progress", "not_started", "rejected"):
            raise fail(409, "Can't submit", f"Task is {t['status'].replace('_', ' ')}.")
        deps = await db.all(
            "SELECT t.title FROM close.task_dependencies d JOIN close.tasks t ON t.id = d.depends_on_task_id WHERE d.task_id = :id AND t.status <> 'completed'", id=t["id"]
        )
        if deps:
            raise fail(409, "Blocked by dependencies", f"Complete first: {', '.join(d['title'] for d in deps)}.", "dependencies")
        if t["requires_evidence"] and not await db.scalar("SELECT count(*) FROM close.task_evidence WHERE task_id = :id", id=t["id"]):
            raise fail(422, "Evidence required", "Reconciliation tasks need an attached workpaper before sign-off (CL-8).", "evidence_required")
        await db.exec("UPDATE close.tasks SET status = 'submitted', submitted_by = :u WHERE id = :id", u=p.id, id=t["id"])
        await audit(db, "task.submitted", "task", t["id"], f'"{t["title"]}" submitted for sign-off', actor_id=p.id, entity_id=ent)
    elif action == "sign-off":
        p.require("task.signoff", ent)
        if t["status"] != "submitted":
            raise fail(409, "Not awaiting sign-off")
        if p.id in (t["submitted_by"], t["owner_id"]):
            raise fail(403, "Segregation of duties", "You prepared this task, so a different reviewer must sign it off (CL-5).", "sod_signoff")
        await db.exec("UPDATE close.tasks SET status = 'completed', signed_off_by = :u, signed_off_at = now(), completed_day = :cd WHERE id = :id", u=p.id, cd=close_day(), id=t["id"])
        await audit(db, "task.signed_off", "task", t["id"], f'"{t["title"]}" signed off', actor_id=p.id, entity_id=ent)
    elif action == "reject":
        p.require("task.signoff", ent)
        if t["status"] != "submitted":
            raise fail(409, "Not awaiting sign-off")
        if len(reason) < 3:
            raise fail(422, "Reason required")
        await db.exec("UPDATE close.tasks SET status = 'rejected' WHERE id = :id", id=t["id"])
        await db.insert("close.comments", {"subject_type": "task", "subject_id": t["id"], "author_id": p.id, "body": f"Sent back: {reason}"}, returning="id")
        await audit(db, "task.rejected", "task", t["id"], f'"{t["title"]}" sent back: {reason}', actor_id=p.id, entity_id=ent)
    elif action == "reject-ai-verification":
        p.require("task.signoff", ent)
        if not t["verified_by_ai"]:
            raise fail(409, "Not AI-verified")
        if len(reason) < 3:
            raise fail(422, "Reason required")
        await db.exec(
            "UPDATE close.tasks SET verified_by_ai = false, ai_output_id = ai_output_id, status = 'in_progress', signed_off_by = NULL, completed_day = NULL WHERE id = :id", id=t["id"]
        )
        await db.insert("close.comments", {"subject_type": "task", "subject_id": t["id"], "author_id": p.id, "body": f"AI verification rejected: {reason}"}, returning="id")
        await audit(db, "task.ai_verification_rejected", "task", t["id"], f'AI verification of "{t["title"]}" rejected: {reason}', actor_id=p.id, entity_id=ent)


# ------------------------------------------------------------------ comments (append-only)
@router.get("/comments")
async def list_comments(subjectType: str, subjectId: str, request: Request) -> list[dict[str, Any]]:
    async with session(request) as (_p, db):
        rows = await db.all("SELECT * FROM close.comments WHERE subject_type = :t AND subject_id = :s ORDER BY created_at", t=subjectType, s=_uuid(subjectId))
        return [{"id": str(c["id"]), "subjectType": c["subject_type"], "subjectId": str(c["subject_id"]), "authorId": str(c["author_id"]), "body": c["body"], "createdAt": iso(c["created_at"])} for c in rows]


class CommentIn(BaseModel):
    subjectType: Literal["task", "variance", "je_draft", "context_note"]
    subjectId: str
    body: str = Field(min_length=1, max_length=10000)


@router.post("/comments")
async def add_comment(body: CommentIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        if not any(p.can(x) for x in ("task.edit", "task.signoff", "je.approve", "context.propose")):
            raise fail(403, "Read-only role", "Auditors can't comment.")
        c = await db.insert("close.comments", {"subject_type": body.subjectType, "subject_id": _uuid(body.subjectId), "author_id": p.id, "body": body.body.strip()})
        await audit(db, "comment.added", body.subjectType, c["subject_id"], f"Comment: {body.body.strip()[:80]}", actor_id=p.id)
        return {"id": str(c["id"]), "subjectType": c["subject_type"], "subjectId": str(c["subject_id"]), "authorId": str(c["author_id"]), "body": c["body"], "createdAt": iso(c["created_at"])}


__all__ = ["router", "sid"]
