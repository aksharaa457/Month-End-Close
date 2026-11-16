"""Request id, CSRF (double-submit cookie) and idempotency keys (ARCHITECTURE §5.1, §6.2)."""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from app.core.auth import load_session
from app.core.config import settings
from app.core.db import tenant_tx

WRITE = {"POST", "PUT", "PATCH", "DELETE"}
PUBLIC_WRITES = {"/api/v1/auth/callback", "/api/v1/auth/logout"}


def _problem(status: int, title: str, detail: str, code: str, rid: str) -> JSONResponse:
    return JSONResponse(
        {"type": f"https://errors.cch.example/{code}", "title": title, "status": status, "detail": detail, "code": code, "requestId": rid},
        status_code=status,
        media_type="application/problem+json",
    )


class RequestMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        rid = request.headers.get("X-Request-Id") or uuid.uuid4().hex
        request.state.request_id = rid
        s = settings()
        is_write = request.method in WRITE and request.url.path.startswith("/api/") and request.url.path not in PUBLIC_WRITES

        if is_write:
            cookie = request.cookies.get(s.csrf_cookie, "")
            header = request.headers.get("X-CSRF-Token", "")
            if not cookie or not hmac.compare_digest(cookie, header):
                return _problem(403, "CSRF check failed", "Reload the page and try again.", "csrf", rid)

        key = request.headers.get("Idempotency-Key")
        sess = None
        req_hash = b""
        if is_write and key:
            sess = await load_session(request.cookies.get(s.session_cookie))
            if sess:
                body = await request.body()
                req_hash = hashlib.sha256(request.method.encode() + request.url.path.encode() + body).digest()
                async with tenant_tx(sess["tenant_id"]) as db:
                    prev = await db.one(
                        "SELECT request_hash, response_status, response_body FROM core.idempotency_keys WHERE key = :k AND expires_at > now()",
                        k=key,
                    )
                if prev:
                    if bytes(prev["request_hash"]) != req_hash:
                        return _problem(422, "Idempotency key reused", "This key was already used for a different request.", "idempotency_conflict", rid)
                    if prev["response_status"] is not None:
                        return JSONResponse(prev["response_body"], status_code=prev["response_status"], headers={"Idempotent-Replay": "true", "X-Request-Id": rid})

        response = await call_next(request)
        response.headers["X-Request-Id"] = rid

        if sess and response.status_code < 500 and response.headers.get("content-type", "").startswith("application/json"):
            chunks = [c async for c in response.body_iterator]  # type: ignore[attr-defined]
            raw = b"".join(c if isinstance(c, bytes) else c.encode() for c in chunks)
            try:
                async with tenant_tx(sess["tenant_id"]) as db:
                    await db.exec(
                        """INSERT INTO core.idempotency_keys (tenant_id, key, user_id, request_hash, response_status, response_body)
                           VALUES (:t, :k, :u, :h, :st, CAST(:b AS jsonb)) ON CONFLICT DO NOTHING""",
                        t=sess["tenant_id"], k=key, u=sess["user_id"], h=req_hash, st=response.status_code, b=raw.decode() or "{}",
                    )
            except Exception:  # noqa: S110 - never fail a completed request because the replay record couldn't be saved
                pass
            headers = {k: v for k, v in response.headers.items() if k.lower() != "content-length"}
            return Response(content=raw, status_code=response.status_code, headers=headers, media_type="application/json")
        return response


def install(app: FastAPI) -> None:
    app.add_middleware(RequestMiddleware)


__all__ = ["install", "json"]
