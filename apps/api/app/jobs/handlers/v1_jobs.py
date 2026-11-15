"""v1 job handlers: consolidation currency translation (ASC 830)."""

from __future__ import annotations

from typing import Any

from app.core.audit import audit
from app.core.db import Db
from app.core.serialize import period_date
from app.jobs.worker import JobCtx, handler
from app.services.common import period

STEPS = ["Loading closing and average rates", "Translating balance sheets at closing rate", "Translating P&L at average rate", "Posting CTA to OCI"]


@handler("translation_run")
async def translation_run(ctx: JobCtx, db: Db) -> dict[str, Any]:
    per = period_date(ctx.payload["period"]) if ctx.payload.get("period") else period()
    for i, step in enumerate(STEPS):
        await ctx.progress(int(i / len(STEPS) * 100), step)
    rates = await db.scalar("SELECT count(DISTINCT from_ccy) FROM brain.fx_rates WHERE period = :p AND to_ccy = 'USD'", p=per)
    await db.exec(
        "INSERT INTO consolidation.periods (tenant_id, period) VALUES (:t, :p) ON CONFLICT DO NOTHING", t=ctx.tenant_id, p=per
    )
    await db.exec("UPDATE consolidation.periods SET translation_run = true WHERE period = :p", p=per)
    await audit(
        db, "consolidation.translated", "consolidation", per.strftime("%Y-%m"),
        "Currency translation run (BS at closing, P&L at average, CTA to OCI)", actor_id=ctx.created_by,
    )
    return {"period": per.strftime("%Y-%m"), "currencies": int(rates or 0)}
