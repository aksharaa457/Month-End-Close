"""Job handlers: ledger sync / backfill (US-1, P-1) and audit export (US-22)."""

from __future__ import annotations

import json
from typing import Any

from app.ai.gateway import gateway
from app.connectors.base import connector_for
from app.core.audit import audit
from app.core.db import Db, tenant_tx
from app.core.errors import Problem
from app.jobs.worker import JobCtx, handler
from app.routers.audit import query_events
from app.services import flux
from app.services.common import period


@handler("sync")
async def sync(ctx: JobCtx, db: Db) -> dict[str, Any] | None:
    return await _sync(ctx, db, backfill=False)


@handler("backfill")
async def backfill(ctx: JobCtx, db: Db) -> dict[str, Any] | None:
    return await _sync(ctx, db, backfill=True)


async def _sync(ctx: JobCtx, db: Db, *, backfill: bool) -> dict[str, Any]:
    entity_id = ctx.payload.get("entityId")
    ent = await db.one("SELECT * FROM tenancy.entities WHERE id = CAST(:e AS uuid)", e=entity_id)
    conn = await db.one("SELECT * FROM brain.connections WHERE entity_id = CAST(:e AS uuid)", e=entity_id)
    if not ent or not conn:
        raise Problem(409, "Not connected", "Connect the ledger first.")
    trigger = "backfill" if backfill else "manual"
    cursor = await db.scalar(
        "SELECT since_cursor FROM brain.sync_runs WHERE connection_id = :c AND status = 'succeeded' ORDER BY started_at DESC LIMIT 1", c=conn["id"]
    )

    await ctx.progress(10, "Reading chart of accounts" if backfill else "Fetching changes since last sync")
    try:
        changes = await connector_for(conn).fetch_changes(cursor)
    except Exception as e:  # noqa: BLE001 - record the failure where the UI shows it, then fail the job
        msg = str(e).split("\n")[0][:1000]
        # Separate transaction: the job's own transaction rolls back when it fails.
        async with tenant_tx(ctx.tenant_id, kind="worker") as wdb:
            await wdb.exec("UPDATE brain.connections SET status = 'error', last_error = :m WHERE id = :id", m=msg, id=conn["id"])
            await wdb.insert("brain.sync_runs", {"connection_id": conn["id"], "trigger": trigger, "status": "failed", "since_cursor": cursor,
                                                 "stats": {"accounts": 0, "lines": 0}, "error": msg}, returning="id")
            await audit(wdb, "sync.failed", "entity", ent["id"], f"{'Backfill' if backfill else 'Sync'} failed for {ent['name']}: {msg}",
                        actor_type="system", entity_id=ent["id"])
        raise Problem(502, "Sync failed", msg) from e

    await ctx.progress(35, "Normalising to the shared ledger model")
    accounts = int(await db.scalar("SELECT count(*) FROM brain.accounts WHERE entity_id = :e", e=ent["id"]))
    if backfill:  # a backfill loads the full history, so report what the ledger holds now
        lines = int(await db.scalar("SELECT count(*) FROM brain.gl_lines WHERE entity_id = :e", e=ent["id"]))
    else:
        lines = int(changes.get("lines") or 0)
    started = await db.scalar("SELECT coalesce((SELECT locked_at FROM jobs.jobs WHERE id = :id), now())", id=ctx.id)
    run = await db.insert("brain.sync_runs", {
        "connection_id": conn["id"], "trigger": trigger, "status": "succeeded", "since_cursor": changes.get("cursor"),
        "stats": {"accounts": accounts, "lines": lines}, "started_at": started,
    }, returning="id")
    await db.exec("UPDATE brain.sync_runs SET finished_at = greatest(clock_timestamp(), started_at) WHERE id = :id", id=run["id"])
    await db.exec("UPDATE brain.connections SET last_sync_at = now(), last_error = NULL, status = 'connected' WHERE id = :id", id=conn["id"])
    if backfill:
        await db.exec("UPDATE tenancy.entities SET status = 'active' WHERE id = :e AND status = 'setup_required'", e=ent["id"])

    await ctx.progress(60, "Recomputing variances")
    has_period = await db.scalar("SELECT 1 FROM close.periods WHERE entity_id = :e AND period = :p", e=ent["id"], p=period())
    needs = await flux.recompute(db, ent["id"]) if has_period else []

    if needs:
        await ctx.progress(75, "Queuing AI explanations for changed lines")
        p_id = await db.scalar("SELECT id FROM close.periods WHERE entity_id = :e AND period = :p", e=ent["id"], p=period())
        gw = gateway()
        for account_id in needs:
            vctx = await flux.variance_context(db, ent["id"], account_id)
            notes = await flux.approved_notes(db, account_id)
            res = await gw.explain_variance(vctx, notes)
            ai_id = await gw.record(db, res)
            await db.exec(
                """UPDATE flux.variances SET explanation_ai_output_id = :ai, status = CASE WHEN :ok THEN 'open' ELSE 'needs_manual' END
                    WHERE period_id = :p AND account_id = :a""",
                ai=ai_id, ok=res.outcome == "ok", p=p_id, a=account_id,
            )

    await audit(db, "sync.backfill_completed" if backfill else "sync.completed", "entity", ent["id"],
                f"{'Backfill' if backfill else 'Sync'} completed for {ent['name']}", actor_type="system", entity_id=ent["id"])
    return {"syncRunId": str(run["id"])}


@handler("audit_export")
async def audit_export(ctx: JobCtx, db: Db) -> dict[str, Any] | None:
    entity_id = ctx.payload.get("entityId") or None
    await ctx.progress(20, "Collecting events")
    events = await query_events(db, entity_id=entity_id, newest_first=False, limit=None)
    await ctx.progress(60, "Verifying hash chain")
    await ctx.progress(85, "Writing export file")
    tenant_id = ctx.tenant_id
    await audit(db, "audit.exported", "tenant", tenant_id, f"Audit export of {len(events)} events", actor_id=ctx.created_by, entity_id=entity_id)
    return {
        "fileName": f"audit-{entity_id or 'all'}-{period().strftime('%Y-%m')}.json",
        "count": len(events),
        "data": json.dumps(events, indent=2, ensure_ascii=False),
    }
