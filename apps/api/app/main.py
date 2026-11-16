"""Continuous Close Hub API. Run: uv run uvicorn app.main:app --reload --port 8001"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core import errors, middleware
from app.core.db import dispose_engines
from app.routers import audit, auth, close, flux, journals, setup, v1


@asynccontextmanager
async def lifespan(_: FastAPI):  # type: ignore[no-untyped-def]
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    yield
    await dispose_engines()


app = FastAPI(title="Continuous Close Hub API", version="0.1.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
errors.install(app)
middleware.install(app)
for r in (auth, close, flux, journals, setup, audit, v1):
    app.include_router(r.router)


@app.get("/api/health", include_in_schema=False)
async def health() -> dict[str, str]:
    return {"status": "ok"}
