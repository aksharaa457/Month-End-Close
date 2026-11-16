"""Sessions (ARCHITECTURE §6). Server-side sessions keyed by the SHA-256 of a
random cookie value; created and loaded only through SECURITY DEFINER functions."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Request, Response

from app.core.config import settings
from app.core.db import Db, plain_tx, tenant_tx
from app.core.errors import fail
from app.core.permissions import Principal
from app.core.serialize import iso, user_json


def token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


async def load_session(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    async with plain_tx() as db:
        return await db.one(
            "SELECT * FROM auth.load_session(:h, make_interval(mins => :m))",
            h=token_hash(token),
            m=settings().session_idle_minutes,
        )


async def load_principal(db: Db, sess: dict[str, Any]) -> Principal:
    user = await db.one("SELECT * FROM tenancy.users WHERE id = :id", id=sess["user_id"])
    if not user or user["status"] != "active":
        raise fail(401, "Not signed in", "This account is no longer active.", "unauthenticated")
    mems = await db.all(
        "SELECT id, entity_id, role FROM tenancy.memberships WHERE user_id = :u AND revoked_at IS NULL ORDER BY granted_at",
        u=user["id"],
    )
    return Principal(tenant_id=sess["tenant_id"], user=user, memberships=mems, auth_time=sess["auth_time"])


@asynccontextmanager
async def session(request: Request) -> AsyncIterator[tuple[Principal, Db]]:
    """Authenticate, then open ONE tenant-scoped transaction for the whole request."""
    sess = await load_session(request.cookies.get(settings().session_cookie))
    if not sess:
        raise fail(401, "Not signed in", "Your session has ended. Sign in again.", "unauthenticated")
    async with tenant_tx(sess["tenant_id"]) as db:
        p = await load_principal(db, sess)
        request.state.principal = p
        yield p, db


async def me_json(db: Db, p: Principal) -> dict[str, Any]:
    t = await db.one("SELECT id, name, reporting_currency FROM tenancy.tenants WHERE id = :id", id=p.tenant_id)
    assert t
    return {
        "user": user_json(p.user, p.memberships),
        "tenant": {"id": str(t["id"]), "name": t["name"], "reportingCurrency": t["reporting_currency"].strip()},
        "permissions": p.permissions_json(),
        "authTime": iso(p.auth_time),
    }


async def create_session(
    response: Response, *, org_id: str, workos_user_id: str, email: str, ip: str | None, user_agent: str | None
) -> tuple[uuid.UUID, uuid.UUID]:
    token = secrets.token_urlsafe(32)
    s = settings()
    async with plain_tx() as db:
        row = await db.one(
            "SELECT * FROM auth.create_session(:h, :org, :wu, :email, make_interval(hours => :hrs), CAST(:ip AS inet), :ua)",
            h=token_hash(token),
            org=org_id,
            wu=workos_user_id,
            email=email,
            hrs=s.session_lifetime_hours,
            ip=ip,
            ua=(user_agent or "")[:300],
        )
    if not row:
        raise fail(403, "Not provisioned", "Your organization hasn't given you access to Continuous Close Hub. Ask your admin to invite you.", "not_provisioned")
    csrf = secrets.token_urlsafe(24)
    common: dict[str, Any] = {"secure": s.cookie_secure, "samesite": "lax", "path": "/"}
    response.set_cookie(s.session_cookie, token, httponly=True, max_age=s.session_lifetime_hours * 3600, **common)
    response.set_cookie(s.csrf_cookie, csrf, httponly=False, max_age=s.session_lifetime_hours * 3600, **common)
    return row["tenant_id"], row["user_id"]


def clear_cookies(response: Response) -> None:
    s = settings()
    response.delete_cookie(s.session_cookie, path="/")
    response.delete_cookie(s.csrf_cookie, path="/")
