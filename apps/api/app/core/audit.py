"""Append-only, hash-chained audit events (DATABASE §6.2). The hash is computed
by a database trigger; the app can only INSERT."""

from __future__ import annotations

import uuid
from typing import Any

from app.core.db import Db

_NS = uuid.UUID("6f1c2b1e-58a0-4c1f-9b7d-0c1d2e3f4a5b")


def subject_uuid(value: Any) -> uuid.UUID:
    """Audit subject ids are UUIDs; non-UUID subjects (e.g. a period) get a stable uuid5."""
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return uuid.uuid5(_NS, str(value))


async def audit(
    db: Db,
    action: str,
    subject_type: str,
    subject_id: Any,
    summary: str,
    *,
    actor_id: Any = None,
    actor_type: str | None = None,
    entity_id: Any = None,
    request_id: str | None = None,
) -> None:
    await db.insert(
        "audit.events",
        {
            "actor_type": actor_type or ("user" if actor_id else "system"),
            "actor_id": actor_id,
            "action": action,
            "subject_type": subject_type,
            "subject_id": subject_uuid(subject_id),
            "entity_id": entity_id,
            "summary": summary[:2000],
            "request_id": request_id,
        },
        returning="id",
    )
