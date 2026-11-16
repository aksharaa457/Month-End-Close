"""Integration tests run against a real Postgres (docker compose `db`, port 5433)
in a throwaway database `cch_test`: migrated from scratch, then seeded. RLS,
grants and triggers only behave correctly against a real database
(TECH-STACK §8), so nothing here is mocked except the ERP (simulated) and the
AI model (offline mode)."""

from __future__ import annotations

import os
import subprocess
from collections.abc import AsyncIterator, Awaitable, Callable
from pathlib import Path

import httpx
import psycopg
import pytest

TEST_DB = "cch_test"
HOST = os.environ.get("CCH_TEST_PG", "localhost:5433")
os.environ.update({
    "CCH_DATABASE_URL": f"postgresql+asyncpg://cch_api:cch_api_dev@{HOST}/{TEST_DB}",
    "CCH_WORKER_DATABASE_URL": f"postgresql+asyncpg://cch_worker:cch_worker_dev@{HOST}/{TEST_DB}",
    "CCH_MIGRATION_DATABASE_URL": f"postgresql+psycopg://postgres:postgres@{HOST}/{TEST_DB}",
    "CCH_DEV_IDP": "true",
    "CCH_ENABLE_DEMO_RESET": "false",
})
os.environ.pop("ANTHROPIC_API_KEY", None)  # AI gateway runs in offline mode


def pytest_sessionstart(session: pytest.Session) -> None:
    with psycopg.connect(f"postgresql://postgres:postgres@{HOST}/postgres", autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        c.execute(f"CREATE DATABASE {TEST_DB}")
    root = Path(__file__).resolve().parents[1]
    subprocess.run(["alembic", "upgrade", "head"], cwd=root, check=True, env=os.environ.copy(), capture_output=True)


@pytest.fixture(scope="module", autouse=True)
async def seeded() -> AsyncIterator[None]:
    """Fresh demo data for every test module."""
    from app.core.db import dispose_engines
    from app.seed import seed

    await seed(reset=True)
    yield
    await dispose_engines()


@pytest.fixture(autouse=True)
async def fresh_pool() -> AsyncIterator[None]:
    """Connections belong to an event loop; give every test its own pool."""
    from app.core.db import dispose_engines

    await dispose_engines()
    yield
    await dispose_engines()


Client = Callable[[str], Awaitable[httpx.AsyncClient]]


@pytest.fixture
async def login() -> AsyncIterator[Client]:
    from app.main import app as asgi_app

    clients: list[httpx.AsyncClient] = []

    async def make(email: str) -> httpx.AsyncClient:
        c = httpx.AsyncClient(transport=httpx.ASGITransport(app=asgi_app), base_url="http://test")
        r = await c.post("/api/v1/auth/callback", json={"email": email})
        assert r.status_code == 200, r.text
        c.headers["X-CSRF-Token"] = c.cookies["cch_csrf"]
        clients.append(c)
        return c

    yield make
    for c in clients:
        await c.aclose()


@pytest.fixture
def ids() -> dict[str, str]:
    from app.seed import U

    return {k: str(U(k)) for k in ("e-us", "e-in", "e-eu", "u-priya", "u-omar", "u-maria")}


async def run_jobs() -> int:
    import importlib

    importlib.import_module("app.jobs.handlers")
    from app.jobs.worker import drain

    return await drain()
