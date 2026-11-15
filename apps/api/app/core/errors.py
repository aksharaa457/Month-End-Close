"""RFC 9457 problem details for every error (ARCHITECTURE §5.1)."""

from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError

log = logging.getLogger("cch")


class Problem(Exception):
    def __init__(self, status: int, title: str, detail: str | None = None, code: str | None = None):
        super().__init__(detail or title)
        self.status, self.title, self.detail, self.code = status, title, detail, code


def fail(status: int, title: str, detail: str | None = None, code: str | None = None) -> Problem:
    """Usage: `raise fail(403, "Not allowed", "...")`."""
    return Problem(status, title, detail, code)


def _body(request: Request, status: int, title: str, detail: str | None, code: str | None) -> JSONResponse:
    rid = getattr(request.state, "request_id", None) or uuid.uuid4().hex
    return JSONResponse(
        {"type": f"https://errors.cch.example/{code or status}", "title": title, "status": status, "detail": detail, "code": code, "requestId": rid},
        status_code=status,
        media_type="application/problem+json",
    )


# Postgres refusals from triggers/constraints, mapped to user-facing problems.
_PG_CODES = {
    "23514": (409, "Rule violated"),  # check_violation (period lock, SOD, balancing triggers)
    "23505": (409, "Already exists"),  # unique_violation
    "23503": (422, "Invalid reference"),  # foreign_key_violation
    "42501": (403, "Not allowed"),  # insufficient_privilege (RLS / grants / insert-only)
    "40001": (409, "Changed since you loaded it"),  # serialization_failure (stale version)
}


def install(app: FastAPI) -> None:
    @app.exception_handler(Problem)
    async def _problem(request: Request, exc: Problem):  # type: ignore[no-untyped-def]
        return _body(request, exc.status, exc.title, exc.detail, exc.code)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):  # type: ignore[no-untyped-def]
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(x) for x in first.get("loc", [])[1:])
        return _body(request, 422, "Invalid request", f"{where}: {first.get('msg', 'invalid')}".strip(": "), "validation")

    @app.exception_handler(DBAPIError)
    async def _db(request: Request, exc: DBAPIError):  # type: ignore[no-untyped-def]
        code = getattr(exc.orig, "sqlstate", None) or getattr(getattr(exc.orig, "__cause__", None), "sqlstate", None)
        if code in _PG_CODES:
            status, title = _PG_CODES[code]
            msg = str(getattr(exc.orig, "args", [""])[0] or exc.orig).split("\n")[0]
            msg = msg.split(": ", 1)[-1]
            return _body(request, status, title, msg, f"db_{code}")
        log.exception("database error")
        return _body(request, 500, "Server error", "A database error occurred.", "db_error")
