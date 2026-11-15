"""Postgres-backed job queue (TECH-STACK D-2). Jobs are inserted in the SAME
transaction as the state change that needs them (transactional outbox), so a
committed change can't lose its job and a rolled-back change never runs one."""

from __future__ import annotations

from typing import Any

from app.core.db import Db
from app.core.serialize import iso


async def enqueue(db: Db, kind: str, payload: dict[str, Any] | None = None, *, created_by: Any = None, message: str = "Queued") -> dict[str, Any]:
    row = await db.insert("jobs.jobs", {"kind": kind, "payload": payload or {}, "created_by": created_by, "message": message})
    return job_json(row)


def job_json(r: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": str(r["id"]),
        "kind": r["kind"],
        "status": r["status"],
        "progress": int(r["progress"]),
        "message": r["error"] if r["status"] == "failed" and r.get("error") else r["message"],
        "createdAt": iso(r["created_at"]),
    }
    if r.get("result") is not None:
        out["result"] = r["result"]
    return out
