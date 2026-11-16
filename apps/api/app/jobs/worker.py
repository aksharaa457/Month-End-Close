"""Worker process: claims jobs (SKIP LOCKED) and runs them under the job's tenant.

Run with:  uv run python -m app.jobs.worker
"""

from __future__ import annotations

import asyncio
import logging
import signal
import traceback
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.core.db import Db, plain_tx, tenant_tx
from app.core.errors import Problem

log = logging.getLogger("cch.worker")


@dataclass
class JobCtx:
    id: uuid.UUID
    tenant_id: uuid.UUID
    kind: str
    payload: dict[str, Any]
    created_by: uuid.UUID | None

    async def progress(self, pct: int, message: str) -> None:
        """Committed immediately in its own short transaction so the UI sees it."""
        async with tenant_tx(self.tenant_id, kind="worker") as db:
            await db.exec("UPDATE jobs.jobs SET progress = :p, message = :m WHERE id = :id", p=max(0, min(99, pct)), m=message, id=self.id)


Handler = Callable[[JobCtx, Db], Awaitable[dict[str, Any] | None]]
HANDLERS: dict[str, Handler] = {}


def handler(kind: str) -> Callable[[Handler], Handler]:
    def deco(fn: Handler) -> Handler:
        HANDLERS[kind] = fn
        return fn

    return deco


async def run_one() -> bool:
    """Claim and run one job. Returns False when the queue is empty."""
    async with plain_tx(kind="worker") as db:
        job = await db.one("SELECT * FROM jobs.claim_next()")
    if not job:
        return False
    ctx = JobCtx(job["id"], job["tenant_id"], job["kind"], job["payload"] or {}, job["created_by"])
    fn = HANDLERS.get(ctx.kind)
    try:
        if fn is None:
            raise Problem(500, "Unknown job", f"No handler for job kind {ctx.kind!r}")
        # The job's real work and its completion are committed together.
        async with tenant_tx(ctx.tenant_id, kind="worker") as db:
            result = await fn(ctx, db)
            await db.exec(
                "UPDATE jobs.jobs SET status = 'succeeded', progress = 100, message = 'Done', result = CAST(:r AS jsonb), finished_at = now() WHERE id = :id",
                r=result or {},
                id=ctx.id,
            )
    except Exception as e:  # noqa: BLE001 - record any failure on the job
        msg = e.detail or e.title if isinstance(e, Problem) else str(e).split("\n")[0]
        log.warning("job %s (%s) failed: %s\n%s", ctx.id, ctx.kind, msg, traceback.format_exc())
        async with tenant_tx(ctx.tenant_id, kind="worker") as db:
            await db.exec(
                "UPDATE jobs.jobs SET status = 'failed', progress = 100, error = :e, message = :e, finished_at = now() WHERE id = :id",
                e=(msg or "Job failed")[:1000],
                id=ctx.id,
            )
    return True


async def drain(max_jobs: int = 100) -> int:
    """Run queued jobs until empty (used by tests and the dev 'inline' mode)."""
    n = 0
    while n < max_jobs and await run_one():
        n += 1
    return n


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    import app.jobs.handlers  # noqa: F401  (registers handlers)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    log.info("worker started with handlers: %s", ", ".join(sorted(HANDLERS)))
    while not stop.is_set():
        try:
            busy = await run_one()
        except Exception:  # noqa: BLE001
            log.exception("worker loop error")
            busy = False
        if not busy:
            try:
                await asyncio.wait_for(stop.wait(), timeout=0.5)
            except TimeoutError:
                pass


if __name__ == "__main__":
    # Run the copy imported as app.jobs.worker: that's where the handlers register
    # (running this file as __main__ would otherwise create a second, empty registry).
    from app.jobs import worker as _worker

    asyncio.run(_worker.main())
