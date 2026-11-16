"""Shared lookups and JSON shapes used by several routers."""

from __future__ import annotations

import datetime as dt
from typing import Any

from app.core.config import settings
from app.core.db import Arr, Db
from app.core.errors import fail
from app.core.serialize import iso, num, period_date, sid


def period() -> dt.date:
    return period_date(settings().demo_period)


def prior_period() -> dt.date:
    return period_date(settings().demo_prior_period)


def close_day() -> int:
    """'Today' as D+n of the open period. Configurable so demos and tests are stable."""
    return settings().demo_close_day


async def entity_or_404(db: Db, entity_id: Any) -> dict[str, Any]:
    try:
        e = await db.one("SELECT * FROM tenancy.entities WHERE id = CAST(:id AS uuid)", id=str(entity_id))
    except Exception:  # noqa: BLE001 - malformed UUIDs look like "not found"
        e = None
    if not e:
        raise fail(404, "Entity not found")
    return e


async def period_row(db: Db, entity_id: Any) -> dict[str, Any]:
    p = await db.one("SELECT * FROM close.periods WHERE entity_id = :e AND period = :p", e=entity_id, p=period())
    if not p:
        raise fail(404, "Period not found")
    return p


async def assert_open(db: Db, entity_id: Any) -> dict[str, Any]:
    p = await period_row(db, entity_id)
    if p["status"] == "locked":
        raise fail(409, "Period is locked", "Aug 2026 is locked for this entity. Request a reopen first.", "period_locked")
    return p


async def user_names(db: Db) -> dict[str, str]:
    return {str(r["id"]): r["display_name"] for r in await db.all("SELECT id, display_name FROM tenancy.users")}


def ai_json(row: dict[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    out = row.get("output") or {}
    return {
        "id": str(row["id"]),
        "kind": row["kind"],
        "outcome": row["outcome"],
        "modelId": row["model_id"],
        "promptVersion": row["prompt_version"],
        "text": out.get("text", ""),
        "citations": row.get("citations") or [],
        "confidence": num(row.get("confidence")),
        "inferenceRegion": row.get("inference_region") or "n/a",
        "createdAt": iso(row["created_at"]),
        "dataAsOf": iso(row["created_at"]),
        "contextNoteIds": out.get("contextNoteIds", []),
    }


async def ai_by_ids(db: Db, ids: list[Any]) -> dict[str, dict[str, Any]]:
    ids = [i for i in ids if i]
    if not ids:
        return {}
    rows = await db.all("SELECT * FROM ai.ai_outputs WHERE id = ANY(:ids)", ids=Arr(ids, "uuid[]"))
    return {str(r["id"]): ai_json(r) for r in rows}  # type: ignore[misc]


def entity_json(e: dict[str, Any], conn: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "id": str(e["id"]),
        "name": e["name"],
        "region": e["region"],
        "erpType": e["erp_type"],
        "functionalCurrency": e["functional_currency"].strip(),
        "status": e["status"],
        "ownershipPct": num(e["ownership_pct"]),
        "parentId": sid(e["parent_id"]),
        "connection": {
            "status": conn["status"] if conn else "pending",
            "lastSyncAt": iso(conn["last_sync_at"]) if conn else None,
            "lastError": conn["last_error"] if conn else None,
            "secretRef": _mask(conn["secret_ref"]) if conn else None,
        },
    }


def _mask(ref: str | None) -> str | None:
    if not ref:
        return None
    return ref[: max(0, len(ref) - 6)] + "••••" if len(ref) > 10 else "••••"
