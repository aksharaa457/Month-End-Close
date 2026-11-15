"""JSON helpers. Money is NUMERIC/Decimal in the database and in services; it
becomes a JSON number only at the API edge (the contract in apps/web types.ts)."""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import Any


def iso(v: dt.datetime | None) -> str | None:
    return v.astimezone(dt.UTC).isoformat().replace("+00:00", "Z") if v else None


def day(v: dt.date | None) -> str | None:
    return v.isoformat() if v else None


def period_key(v: dt.date | str | None) -> str | None:
    if v is None:
        return None
    return v.strftime("%Y-%m") if isinstance(v, dt.date) else str(v)[:7]


def period_date(key: str) -> dt.date:
    y, m = key.split("-")[:2]
    return dt.date(int(y), int(m), 1)


def num(v: Decimal | float | int | None) -> float | None:
    return None if v is None else float(v)


def sid(v: uuid.UUID | str | None) -> str | None:
    return None if v is None else str(v)


def user_json(u: dict[str, Any], memberships: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "id": str(u["id"]),
        "name": u["display_name"],
        "email": u["email"],
        "title": u.get("title") or "",
        "status": u["status"],
        "memberships": [{"id": str(m["id"]), "entityId": sid(m["entity_id"]), "role": m["role"]} for m in memberships],
    }
