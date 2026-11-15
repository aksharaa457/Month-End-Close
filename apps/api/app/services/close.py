"""Close status, lock gates, forecast and task shapes (HUB-1..5, OV-1..6, CL-1..8)."""

from __future__ import annotations

import datetime as dt
from typing import Any

from app.core.db import Db
from app.core.serialize import iso, sid
from app.services.common import ai_by_ids, close_day, period, period_row
from app.services.recognition import evaluate_contracts

PHASES = ["pre_close", "reconciliations", "accruals", "intercompany", "compliance", "board_pack"]


async def lock_gates(db: Db, entity_id: Any) -> list[dict[str, Any]]:
    p = await period_row(db, entity_id)
    t = await db.one(
        "SELECT count(*) AS total, count(*) FILTER (WHERE status <> 'completed') AS open FROM close.tasks WHERE period_id = :p", p=p["id"]
    )
    v = await db.one(
        """SELECT count(*) FILTER (WHERE is_flagged) AS flagged,
                  count(*) FILTER (WHERE is_flagged AND status NOT IN ('signed_off', 'exception')) AS unsigned
             FROM flux.variances WHERE period_id = :p""",
        p=p["id"],
    )
    unmapped = await db.scalar(
        """SELECT count(*) FROM brain.accounts a
            WHERE a.entity_id = :e AND NOT a.is_group AND a.std_account_id IS NULL AND a.is_active
              AND EXISTS (SELECT 1 FROM brain.gl_balances b WHERE b.account_id = a.id AND b.amount_functional <> 0)""",
        e=entity_id,
    )
    assert t and v
    e = str(entity_id)
    return [
        {"key": "tasks", "label": "All checklist tasks completed", "met": t["open"] == 0,
         "detail": "All tasks are complete." if t["open"] == 0 else f"{t['open']} of {t['total']} tasks are not complete.", "link": f"/e/{e}/checklist"},
        {"key": "variances", "label": "Every flagged variance signed off or excepted", "met": v["unsigned"] == 0,
         "detail": "All flagged lines are signed off." if v["unsigned"] == 0 else f"{v['unsigned']} of {v['flagged']} flagged lines still need sign-off.", "link": f"/e/{e}/flux"},
        {"key": "mappings", "label": "No unmapped accounts with a balance", "met": unmapped == 0,
         "detail": "Every account with a balance is mapped." if unmapped == 0 else f"{unmapped} account(s) with a balance are unmapped.", "link": f"/setup?tab=mapping&entity={e}"},
    ]


async def _task_counts(db: Db, period_id: Any) -> dict[str, int]:
    r = await db.one(
        """SELECT count(*) AS total,
                  count(*) FILTER (WHERE status = 'completed') AS done,
                  count(*) FILTER (WHERE status <> 'completed' AND due_day < :cd) AS overdue
             FROM close.tasks WHERE period_id = :p""",
        p=period_id, cd=close_day(),
    )
    assert r
    return {k: int(v) for k, v in r.items()}


def projection(done: int, total: int) -> float:
    """Simple pace model: remaining tasks at the observed rate, assuming parallel work."""
    velocity = max(done / max(close_day(), 1), 1) * 2
    return round(close_day() + (total - done) / velocity, 1)


async def entity_summary(db: Db, e: dict[str, Any]) -> dict[str, Any]:
    p = await period_row(db, e["id"])
    c = await _task_counts(db, p["id"])
    conn = await db.one("SELECT last_sync_at FROM brain.connections WHERE entity_id = :e", e=e["id"])
    active = e["status"] == "active"
    projected = (close_day() if p["status"] == "locked" else projection(c["done"], c["total"])) if active else None
    status = "setup_required"
    if active:
        tgt = p["target_close_day"]
        status = "on_track" if projected <= tgt + 0.5 else "needs_review" if projected <= tgt + 1.5 else "at_risk"  # type: ignore[operator]
    return {
        "entityId": str(e["id"]), "entityName": e["name"], "region": e["region"], "erpType": e["erp_type"],
        "period": p["period"].strftime("%Y-%m"), "status": status, "periodStatus": p["status"],
        "tasksTotal": c["total"], "tasksDone": c["done"] if active else 0, "tasksOverdue": c["overdue"] if active else 0,
        "pctComplete": round(c["done"] / c["total"] * 100, 1) if active and c["total"] else 0,
        "targetCloseDay": p["target_close_day"], "projectedCloseDay": projected,
        "lastSyncAt": iso(conn["last_sync_at"]) if conn else None,
    }


def _day(n: float) -> str:
    return f"D+{int(n) if float(n).is_integer() else n}"


async def forecast(db: Db, entities: list[dict[str, Any]]) -> dict[str, Any]:
    active = [e for e in entities if e["status"] == "active"]
    sums = [await entity_summary(db, e) for e in active]
    worst = max(sums, key=lambda s: s["projectedCloseDay"] or 0, default=None)
    plan = worst["targetCloseDay"] if worst else 6
    projected = worst["projectedCloseDay"] if worst else plan
    ids = [e["id"] for e in active]
    for i in ids:
        await evaluate_contracts(db, i)
    overdue = await db.all(
        """SELECT t.title, p.entity_id, e.name FROM close.tasks t JOIN close.periods p ON p.id = t.period_id
             JOIN tenancy.entities e ON e.id = p.entity_id
            WHERE p.period = :per AND e.status = 'active' AND t.status <> 'completed' AND t.due_day < :cd ORDER BY t.due_day""",
        per=period(), cd=close_day(),
    )
    unsigned = await db.all(
        """SELECT p.entity_id FROM flux.variances v JOIN close.periods p ON p.id = v.period_id
             JOIN tenancy.entities e ON e.id = p.entity_id
            WHERE p.period = :per AND e.status = 'active' AND v.is_flagged AND v.status NOT IN ('signed_off', 'exception')""",
        per=period(),
    )
    gating = await db.all(
        "SELECT entity_id FROM recognition.contracts WHERE column_status = 'needs_review' AND decision_action IS NULL"
    )
    drags = []
    if worst:
        drags.append({"label": f"{worst['entityName']} is the critical path", "detail": f"Projected {_day(projected)} against a plan of {_day(plan)}.", "link": f"/e/{worst['entityId']}/overview"})
    if overdue:
        detail = ", ".join(f"{o['title']} ({o['name'].replace('Northwind ', '')})" for o in overdue[:3])
        drags.append({"label": f"{len(overdue)} overdue tasks", "detail": detail, "link": f"/e/{overdue[0]['entity_id']}/checklist?filter=overdue"})
    if unsigned:
        drags.append({"label": f"{len(unsigned)} flagged variances not signed off", "detail": "Flux & variance is behind pace.", "link": f"/e/{unsigned[0]['entity_id']}/flux"})
    if gating:
        drags.append({"label": f"{len(gating)} recognition decisions open", "detail": "Recognition run is held until the gating queue is decided.", "link": f"/e/{gating[0]['entity_id']}/recognition"})
    return {"projectedCloseDay": projected, "planCloseDay": plan, "varianceDays": round(projected - plan, 1), "drags": drags}


async def period_detail(db: Db, e: dict[str, Any]) -> dict[str, Any]:
    p = await period_row(db, e["id"])
    tasks = await db.all("SELECT phase, status, due_day, completed_day FROM close.tasks WHERE period_id = :p", p=p["id"])
    total = len(tasks)
    done = [t for t in tasks if t["status"] == "completed"]
    overdue = [t for t in tasks if t["status"] != "completed" and t["due_day"] < close_day()]
    projected = projection(len(done), total)
    last = max(int(projected) + 1, p["target_close_day"], close_day()) + 1
    burndown = []
    remaining_now = total - len(done)
    for d in range(last + 1):
        plan = max(0.0, round(total - total / p["target_close_day"] * d, 1))
        actual = total - len([t for t in done if (t["completed_day"] if t["completed_day"] is not None else 99) <= d]) if d <= close_day() else None
        proj = (
            max(0.0, round(remaining_now - remaining_now / max(projected - close_day(), 0.1) * (d - close_day()), 1))
            if d >= close_day() else None
        )
        burndown.append({"day": d, "plan": plan, "actual": actual, "projected": proj})
    vstats = await db.one(
        """SELECT count(*) FILTER (WHERE is_flagged) AS flagged,
                  count(*) FILTER (WHERE is_flagged AND status IN ('signed_off','exception')) AS signed
             FROM flux.variances WHERE period_id = :p""",
        p=p["id"],
    )
    accr = await db.one("SELECT count(*) AS n, count(*) FILTER (WHERE status <> 'suggested') AS decided FROM accruals.proposals WHERE entity_id = :e", e=e["id"])
    rec = await db.one(
        "SELECT count(*) AS n, count(*) FILTER (WHERE decision_action IN ('start','defer') OR (column_status='auto_applied' AND batch_signed_off)) AS decided FROM recognition.contracts WHERE entity_id = :e",
        e=e["id"],
    )
    assert vstats and accr and rec
    gates = await lock_gates(db, e["id"])
    insights = await _insights(db, e, p, overdue_count=len(overdue), gates=gates)
    rr = await db.all("SELECT * FROM close.reopen_requests WHERE period_id = :p ORDER BY requested_at", p=p["id"])
    pct = lambda a, b: round(a / b * 100) if b else 100  # noqa: E731
    return {
        "id": str(p["id"]), "entityId": str(e["id"]), "period": p["period"].strftime("%Y-%m"), "status": p["status"],
        "targetCloseDay": p["target_close_day"], "targetDate": (p["period"] + dt.timedelta(days=31)).replace(day=p["target_close_day"]).isoformat(),
        "lockedAt": iso(p["locked_at"]), "lockedBy": sid(p["locked_by"]), "closeDay": close_day(),
        "health": {"tasksTotal": total, "tasksDone": len(done), "tasksOpen": total - len(done), "tasksOverdue": len(overdue), "pctComplete": round(len(done) / total * 100, 1) if total else 0},
        "gates": gates,
        "reopenRequests": [
            {"id": str(r["id"]), "reason": r["reason"], "requestedBy": str(r["requested_by"]), "requestedAt": iso(r["requested_at"]), "status": r["status"], "decidedBy": sid(r["decided_by"])}
            for r in rr
        ],
        "burndown": burndown,
        "workload": [
            {"phase": ph, "complete": len([t for t in tasks if t["phase"] == ph and t["status"] == "completed"]), "open": len([t for t in tasks if t["phase"] == ph and t["status"] != "completed"])}
            for ph in PHASES
        ],
        "modules": [
            {"key": "checklist", "name": "Checklist", "pct": pct(len(done), total), "release": "MVP"},
            {"key": "flux", "name": "Flux & variance", "pct": pct(vstats["signed"], vstats["flagged"]), "release": "MVP"},
            {"key": "accruals", "name": "Accrual & prepaid", "pct": pct(accr["decided"], accr["n"]), "release": "v1"},
            {"key": "recognition", "name": "Recognition & compliance", "pct": pct(rec["decided"], rec["n"]), "release": "v1"},
        ],
        "insights": insights,
        "forecast": await forecast(db, [e]),
    }


async def _insights(db: Db, e: dict[str, Any], p: dict[str, Any], *, overdue_count: int, gates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    eid = str(e["id"])
    out: list[dict[str, Any]] = []
    nm = await db.all(
        """SELECT v.account_id, a.erp_account_code, a.name FROM flux.variances v JOIN brain.accounts a ON a.id = v.account_id
            WHERE v.period_id = :p AND v.status = 'needs_manual' ORDER BY abs(v.delta) DESC""",
        p=p["id"],
    )
    if nm:
        out.append({"id": "i1", "severity": "critical", "text": f"{len(nm)} flagged line(s) have no usable AI explanation and need a manual one (e.g. {nm[0]['erp_account_code']} {nm[0]['name']}).", "link": f"/e/{eid}/flux?variance={nm[0]['account_id']}", "citations": []})  # noqa: E501
    rec = await db.one(
        """SELECT v.delta_pct, v.explanation_ai_output_id FROM flux.variances v JOIN brain.accounts a ON a.id = v.account_id
            WHERE v.period_id = :p AND a.name = 'Recurring Revenue' AND v.is_flagged""",
        p=p["id"],
    )
    if rec:
        ai = (await ai_by_ids(db, [rec["explanation_ai_output_id"]])).get(str(rec["explanation_ai_output_id"]))
        out.append({"id": "i2", "severity": "warning", "text": f"Recurring Revenue is {abs(float(rec['delta_pct'] or 0)):.0f}% below July because the August recognition run is held by the gating queue.", "link": f"/e/{eid}/recognition", "citations": ai["citations"] if ai else []})  # noqa: E501
    if overdue_count:
        titles = await db.all("SELECT title FROM close.tasks WHERE period_id = :p AND status <> 'completed' AND due_day < :cd ORDER BY due_day LIMIT 2", p=p["id"], cd=close_day())
        out.append({"id": "i3", "severity": "warning", "text": f"{overdue_count} task(s) are overdue: {', '.join(t['title'] for t in titles)}.", "link": f"/e/{eid}/checklist?filter=overdue", "citations": []})
    conn = await db.one("SELECT last_error FROM brain.connections WHERE entity_id = :e", e=e["id"])
    if conn and conn["last_error"]:
        out.append({"id": "i4", "severity": "critical", "text": f"Ledger sync problem: {conn['last_error']}", "link": "/setup?tab=connections", "citations": []})
    g = next(x for x in gates if x["key"] == "mappings")
    if not g["met"]:
        out.append({"id": "i5", "severity": "info", "text": g["detail"] + " The period can't lock until they're mapped.", "link": g["link"], "citations": []})
    return out or [{"id": "i0", "severity": "info", "text": "Nothing needs attention right now.", "link": f"/e/{eid}/overview", "citations": []}]


async def tasks_json(db: Db, period_id: Any, task_id: Any = None) -> list[dict[str, Any]]:
    cond = "t.period_id = :p" + (" AND t.id = :tid" if task_id else "")
    params: dict[str, Any] = {"p": period_id}
    if task_id:
        params["tid"] = task_id
    tasks = await db.all(f"SELECT t.*, p.entity_id FROM close.tasks t JOIN close.periods p ON p.id = t.period_id WHERE {cond} ORDER BY t.due_day, t.title", **params)
    if not tasks:
        return []
    ids = [t["id"] for t in tasks]
    from app.core.db import Arr

    subs = await db.all("SELECT * FROM close.subtasks WHERE task_id = ANY(:ids) ORDER BY sort_order, id", ids=Arr(ids, "uuid[]"))
    evs = await db.all("SELECT * FROM close.task_evidence WHERE task_id = ANY(:ids) ORDER BY uploaded_at", ids=Arr(ids, "uuid[]"))
    deps = await db.all("SELECT task_id, depends_on_task_id FROM close.task_dependencies WHERE task_id = ANY(:ids)", ids=Arr(ids, "uuid[]"))
    ai = await ai_by_ids(db, [t["ai_output_id"] for t in tasks])
    out = []
    for t in tasks:
        k = t["id"]
        out.append({
            "id": str(k), "entityId": str(t["entity_id"]), "periodId": str(t["period_id"]),
            "phase": t["phase"], "title": t["title"], "description": t["description"],
            "ownerId": sid(t["owner_id"]), "reviewerId": sid(t["reviewer_id"]), "dueDay": t["due_day"], "status": t["status"],
            "requiresEvidence": t["requires_evidence"], "isReconciliation": t["is_reconciliation"], "verifiedByAi": t["verified_by_ai"],
            "aiVerification": ai.get(str(t["ai_output_id"])) if t["ai_output_id"] else None,
            "subtasks": [{"id": str(s["id"]), "title": s["title"], "isDone": s["is_done"], "aiDrafted": s["ai_drafted"], "removed": s["removed_at"] is not None} for s in subs if s["task_id"] == k],
            "evidence": [
                {"id": str(v["id"]), "fileName": v["file_name"], "sizeBytes": v["size_bytes"], "contentType": v["content_type"], "scanStatus": v["scan_status"], "uploadedBy": str(v["uploaded_by"]), "uploadedAt": iso(v["uploaded_at"])}
                for v in evs if v["task_id"] == k
            ],
            "submittedBy": sid(t["submitted_by"]), "signedOffBy": sid(t["signed_off_by"]),
            "dependsOn": [str(d["depends_on_task_id"]) for d in deps if d["task_id"] == k],
            "version": t["version"], "overdue": t["status"] != "completed" and t["due_day"] < close_day(),
        })
    return out
