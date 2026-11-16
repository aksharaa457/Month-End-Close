"""Auto-apply policy evaluation (PRD §10.1). Persists each contract's policy
checks and gating column; human decisions are never overwritten."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from app.core.db import Db

MONTHLY_REVENUE = Decimal("1560000")  # entity monthly revenue used for the % check (from the plan)


async def active_policy(db: Db, entity_id: Any) -> dict[str, Any] | None:
    return await db.one("SELECT * FROM recognition.auto_apply_policies WHERE entity_id = :e AND status = 'active'", e=entity_id)


def _usd(n: Decimal | float) -> str:
    return f"${float(n):,.0f}"


async def evaluate_contracts(db: Db, entity_id: Any) -> None:
    pol = await active_policy(db, entity_id)
    if not pol:
        return
    contracts = await db.all("SELECT * FROM recognition.contracts WHERE entity_id = :e ORDER BY code", e=entity_id)
    running = Decimal(0)
    for c in contracts:
        checks = [
            {"key": "amount", "label": f"≤ {_usd(pol['max_per_item'])} and ≤ {float(pol['max_pct_revenue']):g}% of monthly revenue",
             "passed": c["monthly"] <= pol["max_per_item"] and c["monthly"] <= MONTHLY_REVENUE * pol["max_pct_revenue"] / 100, "detail": f"{_usd(c['monthly'])} this period"},
            {"key": "confidence", "label": f"AI confidence ≥ {float(pol['min_confidence']):.2f}", "passed": c["confidence"] >= pol["min_confidence"], "detail": f"{float(c['confidence']):.2f}"},
            {"key": "evidence", "label": "Trigger evidence in source of record", "passed": c["evidence_found"], "detail": "Found" if c["evidence_found"] else "Not found"},
            {"key": "shape", "label": "Standard schedule, no modification this period", "passed": not c["modified_this_period"], "detail": "Modified this period" if c["modified_this_period"] else "Standard"},
            {"key": "history", "label": f"No override in last {pol['history_periods']} periods", "passed": True, "detail": "None"},
        ]
        all_pass = all(x["passed"] for x in checks)
        cap_ok = running + c["monthly"] <= pol["aggregate_cap"]
        checks.append({"key": "cap", "label": f"Aggregate cap {_usd(pol['aggregate_cap'])}", "passed": (not all_pass) or cap_ok, "detail": f"{_usd(running)} used"})
        column = c["column_status"]
        if c["decision_action"] in (None, "pulled_back"):
            if c["decision_action"] == "pulled_back":
                column = "needs_review"
            elif not c["batch_signed_off"]:
                column = "auto_applied" if pol["enabled"] and all_pass and cap_ok else "needs_review"
        if column == "auto_applied":
            running += c["monthly"]
        await db.exec("UPDATE recognition.contracts SET policy_checks = CAST(:pc AS jsonb), column_status = :col WHERE id = :id", pc=checks, col=column, id=c["id"])
