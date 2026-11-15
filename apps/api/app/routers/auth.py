"""Auth (ARCHITECTURE §6.1): WorkOS SSO when configured, otherwise a dev identity
provider that lists the tenant's users (local development only)."""

from __future__ import annotations

import secrets
import urllib.parse

import httpx
from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import create_async_engine

from app.core import auth as A
from app.core.audit import audit
from app.core.config import settings
from app.core.db import Db, plain_tx, tenant_tx
from app.core.errors import fail
from app.core.permissions import Principal

router = APIRouter(prefix="/api/v1")


def _dev_engine():  # type: ignore[no-untyped-def]
    """Dev IdP only: reads the directory before any tenant is known."""
    return create_async_engine(settings().migration_database_url.replace("+psycopg", "+asyncpg"))


def _workos() -> bool:
    return bool(settings().workos_client_id and settings().workos_api_key)


@router.get("/auth/login")
async def login() -> dict[str, str]:
    state = secrets.token_urlsafe(16)
    if _workos():
        q = urllib.parse.urlencode({"client_id": settings().workos_client_id, "redirect_uri": settings().workos_redirect_uri, "response_type": "code", "state": state, "provider": "authkit"})
        return {"redirectUrl": f"https://api.workos.com/user_management/authorize?{q}"}
    if not settings().dev_idp:
        raise fail(503, "SSO not configured", "Set CCH_WORKOS_CLIENT_ID and CCH_WORKOS_API_KEY.")
    return {"redirectUrl": f"/sso/idp?state={state}"}


@router.get("/auth/idp-directory")
async def idp_directory() -> list[dict[str, str]]:
    if _workos() or not settings().dev_idp:
        raise fail(404, "Not found")
    eng = _dev_engine()
    async with eng.connect() as conn:
        from sqlalchemy import text

        rows = (await conn.execute(text("SELECT display_name, email, title, status FROM tenancy.users ORDER BY status, display_name"))).mappings().all()
    await eng.dispose()
    return [{"email": r["email"], "name": r["display_name"], "title": r["title"], "status": r["status"]} for r in rows]


class CallbackIn(BaseModel):
    email: EmailStr | None = None
    code: str | None = Field(default=None, max_length=500)
    state: str | None = None


@router.post("/auth/callback")
async def callback(body: CallbackIn, request: Request, response: Response) -> dict:  # type: ignore[type-arg]
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    if _workos():
        if not body.code:
            raise fail(422, "Missing code")
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.post(
                "https://api.workos.com/user_management/authenticate",
                json={"client_id": settings().workos_client_id, "client_secret": settings().workos_api_key, "grant_type": "authorization_code", "code": body.code},
            )
        if r.status_code != 200:
            raise fail(401, "Sign-in failed", "The identity provider didn't confirm this sign-in.")
        prof = r.json()
        org, wu, email = prof.get("organization_id") or "", prof["user"]["id"], prof["user"]["email"]
    else:
        if not settings().dev_idp or not body.email:
            raise fail(422, "Missing email")
        eng = _dev_engine()
        async with eng.connect() as conn:
            from sqlalchemy import text

            row = (await conn.execute(
                text("SELECT u.workos_user_id, u.status, t.workos_org_id FROM tenancy.users u JOIN tenancy.tenants t ON t.id = u.tenant_id WHERE lower(u.email) = lower(:e)"),
                {"e": str(body.email)},
            )).mappings().first()
        await eng.dispose()
        if not row:
            raise fail(403, "Not provisioned", "Your organization hasn't given you access to Continuous Close Hub. Ask your admin to invite you.", "not_provisioned")
        if row["status"] == "deactivated":
            raise fail(403, "Account deactivated", "This account was deactivated by your identity provider.", "deactivated")
        org, wu, email = row["workos_org_id"], row["workos_user_id"] or f"dev_{str(body.email).split('@')[0]}", str(body.email)
    tenant_id, user_id = await A.create_session(response, org_id=org, workos_user_id=wu, email=email, ip=ip, user_agent=ua)
    async with tenant_tx(tenant_id) as db:
        sess = {"tenant_id": tenant_id, "user_id": user_id, "auth_time": None}
        p = await A.load_principal(db, sess)
        p.auth_time = await db.scalar("SELECT now()")
        await audit(db, "session.created", "user", user_id, f"{p.name} signed in via SSO", actor_id=user_id)
        return await A.me_json(db, p)


@router.post("/auth/logout")
async def logout(request: Request, response: Response) -> dict[str, bool]:
    token = request.cookies.get(settings().session_cookie)
    sess = await A.load_session(token)
    if token:
        async with plain_tx() as db:
            await db.exec("SELECT auth.revoke_session(:h)", h=A.token_hash(token))
    if sess:
        async with tenant_tx(sess["tenant_id"]) as db:
            name = await db.scalar("SELECT display_name FROM tenancy.users WHERE id = :u", u=sess["user_id"])
            await audit(db, "session.revoked", "user", sess["user_id"], f"{name} signed out", actor_id=sess["user_id"])
    A.clear_cookies(response)
    return {"ok": True}


@router.get("/me")
async def me(request: Request) -> dict:  # type: ignore[type-arg]
    async with A.session(request) as (p, db):
        return await A.me_json(db, p)


@router.post("/demo/reset")
async def demo_reset(request: Request) -> dict[str, bool]:
    if not settings().enable_demo_reset:
        raise fail(404, "Not found")
    async with A.session(request) as (p, _db):
        pass
    from app.seed import seed

    await seed(reset=True)
    # The caller's session was wiped by the reset; they'll be asked to sign in again.
    _ = p
    return {"ok": True}


__all__ = ["router", "Db", "Principal"]
