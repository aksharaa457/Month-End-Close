"""Worker jobs for the close loop: AI drafting, ERP posting, explanations."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.ai.gateway import gateway
from app.core.audit import audit
from app.core.db import Db
from app.jobs.worker import JobCtx, handler
from app.services import flux as F
from app.services import journals as J
from app.services.common import period_row


@handler("generate_drafts")
async def generate_drafts(ctx: JobCtx, db: Db) -> dict[str, Any]:
    entity_id = ctx.payload["entityId"]
    pr = await period_row(db, entity_id)
    flagged = await db.scalar("SELECT count(*) FROM flux.variances v JOIN brain.accounts a ON a.id = v.account_id WHERE v.period_id = :p AND v.is_flagged AND NOT a.is_group", p=pr["id"])
    cands = await db.all(
        """SELECT v.id AS variance_id, v.account_id, v.needs_entry, v.explanation_ai_output_id FROM flux.variances v JOIN brain.accounts a ON a.id = v.account_id
            WHERE v.period_id = :p AND v.is_flagged AND NOT a.is_group AND v.needs_entry IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM journals.je_drafts d WHERE d.source_variance_id = v.id AND d.status <> 'withdrawn')""",
        p=pr["id"],
    )
    accounts = await db.all("SELECT erp_account_code AS code, name, account_class AS class FROM brain.accounts WHERE entity_id = :e AND NOT is_group ORDER BY erp_account_code", e=entity_id)
    pol = await J.policy_for(db, entity_id)
    ccy = (await db.scalar("SELECT functional_currency FROM tenancy.entities WHERE id = :e", e=entity_id)).strip()
    created = 0
    for i, c in enumerate(cands):
        await ctx.progress(10 + int(80 * i / max(len(cands), 1)), "Drafting entries with the AI gateway")
        vctx = await F.variance_context(db, entity_id, c["account_id"])
        expl = await db.one("SELECT output FROM ai.ai_outputs WHERE id = :a", a=c["explanation_ai_output_id"]) if c["explanation_ai_output_id"] else None
        vctx["explanation"] = (expl["output"] or {}).get("text", "") if expl else ""
        vctx["accounts"] = accounts
        res = await gateway().propose_entry(vctx, c["needs_entry"])
        ai_id = await gateway().record(db, res)
        if not res.data.get("needs_entry"):
            continue
        amount = Decimal(str(res.data["amount"])).quantize(Decimal("0.01"))
        src = await db.one("SELECT * FROM brain.accounts WHERE id = :a", a=c["account_id"])
        off = await db.one("SELECT * FROM brain.accounts WHERE entity_id = :e AND erp_account_code = :c AND NOT is_group", e=entity_id, c=res.data["offset_account_code"])
        if not src or not off or amount <= 0:
            continue
        debit_src = src["account_class"] in ("expense", "asset")
        typ = res.data["type"]
        d = await db.insert("journals.je_drafts", {
            "number": await J.next_number(db), "period_id": pr["id"], "je_type": typ, "source_type": "variance", "source_variance_id": c["variance_id"],
            "source_label": f"{src['erp_account_code']} {src['name']}", "description": f"{typ.capitalize()} — {src['erp_account_code']} {src['name']}, per Aug 2026 variance review",
            "status": "draft", "created_by_ai": True, "ai_output_id": ai_id, "preparer_id": ctx.created_by, "currency": ccy,
            "requires_second_approval": amount > pol["second_approval_above"], "approval_policy_id": pol["id"],
        })
        await db.insert("journals.je_lines", {"draft_id": d["id"], "line_no": 1, "account_id": src["id"] if debit_src else off["id"], "debit": amount, "credit": Decimal(0)}, returning="id")
        await db.insert("journals.je_lines", {"draft_id": d["id"], "line_no": 2, "account_id": off["id"] if debit_src else src["id"], "debit": Decimal(0), "credit": amount}, returning="id")
        await db.exec("UPDATE flux.variances SET needs_entry = NULL WHERE id = :v", v=c["variance_id"])
        await audit(db, "je_draft.created", "je_draft", d["id"], f"{d['number']} drafted by AI from {d['source_label']} ({typ})", actor_type="ai", entity_id=entity_id)
        created += 1
    return {"created": created, "flagged": int(flagged or 0), "skipped": int(flagged or 0) - created}


@handler("post_je")
async def post_je(ctx: JobCtx, db: Db) -> dict[str, Any]:
    await ctx.progress(30, "Posting to ERP with idempotency key")
    return await J.post_draft(db, ctx.payload["draftId"])


@handler("post_batch")
async def post_batch(ctx: JobCtx, db: Db) -> dict[str, Any]:
    ids = ctx.payload.get("draftIds", [])
    posted = 0
    for i, draft_id in enumerate(ids):
        await ctx.progress(10 + int(85 * i / max(len(ids), 1)), "Posting to ERP with idempotency keys")
        if (await J.post_draft(db, draft_id))["status"] == "posted":
            posted += 1
    return {"approved": ctx.payload.get("approved", len(ids)), "posted": posted, "awaitingSecond": ctx.payload.get("awaitingSecond", 0)}


@handler("explain")
async def explain(ctx: JobCtx, db: Db) -> dict[str, Any]:
    """Explain every flagged line that has no explanation yet (after a sync)."""
    entity_id = ctx.payload["entityId"]
    pr = await period_row(db, entity_id)
    rows = await db.all("SELECT id, account_id FROM flux.variances WHERE period_id = :p AND is_flagged AND explanation_ai_output_id IS NULL", p=pr["id"])
    for i, r in enumerate(rows):
        await ctx.progress(int(90 * i / max(len(rows), 1)), "Explaining flagged lines")
        vctx = await F.variance_context(db, entity_id, r["account_id"])
        res = await gateway().explain_variance(vctx, await F.approved_notes(db, r["account_id"]))
        ai_id = await gateway().record(db, res)
        await db.exec(
            "UPDATE flux.variances SET explanation_ai_output_id = :a, status = CASE WHEN :ok THEN 'open' ELSE 'needs_manual' END WHERE id = :id AND status NOT IN ('signed_off','exception')",
            a=ai_id, ok=res.outcome == "ok", id=r["id"],
        )
    return {"explained": len(rows)}
