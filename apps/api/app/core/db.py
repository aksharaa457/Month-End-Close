"""Database access. Every request runs in ONE transaction with the tenant set
via SET LOCAL (ARCHITECTURE §3.1), so row-level security filters every query and
the setting can't leak to the next request on a pooled connection."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, create_async_engine

from app.core.config import settings

_engines: dict[str, AsyncEngine] = {}


def engine(kind: str = "api") -> AsyncEngine:
    if kind not in _engines:
        url = settings().database_url if kind == "api" else settings().worker_database_url
        _engines[kind] = create_async_engine(url, pool_size=10, max_overflow=5, pool_pre_ping=True)
    return _engines[kind]


async def dispose_engines() -> None:
    for e in _engines.values():
        await e.dispose()
    _engines.clear()


NO_TENANT_COLUMN = {"tenancy.tenants"}


class Arr:
    """A Postgres array parameter, e.g. Arr(ids, "uuid[]")."""

    def __init__(self, items: list[Any], pg_type: str):
        self.items, self.pg_type = items, pg_type

    def value(self) -> list[Any]:
        if self.pg_type == "uuid[]":
            return [uuid.UUID(str(i)) for i in self.items]
        return list(self.items)


def _param(v: Any) -> Any:
    if isinstance(v, Arr):
        return v.value()
    if isinstance(v, dict | list):
        return json.dumps(v, default=str)
    return v


class Db:
    """Thin helper around a connection: parameterised SQL in, dicts out."""

    def __init__(self, conn: AsyncConnection, tenant_id: uuid.UUID | None):
        self.conn = conn
        self.tenant_id = tenant_id

    async def all(self, sql: str, **params: Any) -> list[dict[str, Any]]:
        res = await self.conn.execute(text(sql), {k: _param(v) for k, v in params.items()})
        return [dict(r) for r in res.mappings().all()]

    async def one(self, sql: str, **params: Any) -> dict[str, Any] | None:
        rows = await self.all(sql, **params)
        return rows[0] if rows else None

    async def scalar(self, sql: str, **params: Any) -> Any:
        res = await self.conn.execute(text(sql), {k: _param(v) for k, v in params.items()})
        return res.scalar()

    async def exec(self, sql: str, **params: Any) -> int:
        res = await self.conn.execute(text(sql), {k: _param(v) for k, v in params.items()})
        return res.rowcount

    async def insert(self, table: str, values: Mapping[str, Any], returning: str = "*") -> dict[str, Any]:
        """Insert one row. `table` is always an internal constant, never user input."""
        vals = dict(values)
        if "tenant_id" not in vals and self.tenant_id is not None and table not in NO_TENANT_COLUMN:
            vals["tenant_id"] = self.tenant_id
        cols = ", ".join(vals)
        binds = ", ".join(_bind(k, v) for k, v in vals.items())
        row = await self.one(f"INSERT INTO {table} ({cols}) VALUES ({binds}) RETURNING {returning}", **vals)
        assert row is not None
        return row

    async def update(self, table: str, where: Mapping[str, Any], values: Mapping[str, Any]) -> dict[str, Any] | None:
        sets = ", ".join(f"{k} = {_bind('v_' + k, v)}" for k, v in values.items())
        conds = " AND ".join(f"{k} = :w_{k}" for k in where)
        params = {f"v_{k}": v for k, v in values.items()} | {f"w_{k}": v for k, v in where.items()}
        return await self.one(f"UPDATE {table} SET {sets} WHERE {conds} RETURNING *", **params)


def _bind(name: str, v: Any) -> str:
    if isinstance(v, Arr):
        return f"CAST(:{name} AS {v.pg_type})"
    if isinstance(v, dict | list):
        return f"CAST(:{name} AS jsonb)"
    return f":{name}"


@asynccontextmanager
async def tenant_tx(tenant_id: uuid.UUID | str, kind: str = "api") -> AsyncIterator[Db]:
    async with engine(kind).begin() as conn:
        await conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)})
        yield Db(conn, uuid.UUID(str(tenant_id)))


@asynccontextmanager
async def plain_tx(kind: str = "api") -> AsyncIterator[Db]:
    """No tenant set: only SECURITY DEFINER functions (auth, job claim) return rows."""
    async with engine(kind).begin() as conn:
        yield Db(conn, None)
