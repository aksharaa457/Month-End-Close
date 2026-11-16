"""Setup, audit and v1 modules (accruals, recognition, copilot, consolidation)."""

from __future__ import annotations

from tests.conftest import run_jobs

P = "/api/v1"


async def test_every_read_endpoint_answers(login, ids) -> None:
    maria = await login("maria@northwind.example")
    e = ids["e-us"]
    paths = [
        "/me", "/close/summary", "/notifications", "/entities", "/sources", "/standard-accounts", "/users", "/context-notes",
        f"/entities/{e}/periods/2026-08", f"/entities/{e}/periods/2026-08/tasks", f"/entities/{e}/periods/2026-08/variances",
        f"/entities/{e}/periods/2026-08/je-drafts", f"/entities/{e}/periods/2026-08/je-candidates", f"/entities/{e}/sync-runs",
        f"/entities/{e}/account-mappings", f"/entities/{e}/thresholds", f"/entities/{e}/approval-policies",
        f"/entities/{e}/accruals", f"/entities/{e}/recognition", "/consolidation", "/audit/events", "/audit/verify",
    ]
    for p in paths:
        r = await maria.get(P + p)
        assert r.status_code == 200, (p, r.text[:200])
    assert (await maria.get(f"{P}/audit/verify")).json()["ok"] is True


async def test_auditor_is_read_only_but_sees_audit(login) -> None:
    ellen = await login("ellen@auditfirm.example")
    assert (await ellen.get(f"{P}/audit/events")).status_code == 200
    sam = await login("sam@northwind.example")  # admin: no audit.view
    assert (await sam.get(f"{P}/audit/events")).status_code == 403


async def test_sync_job_updates_freshness(login, ids) -> None:
    sam = await login("sam@northwind.example")
    job = (await sam.post(f"{P}/entities/{ids['e-us']}/sync", json={})).json()
    await run_jobs()
    assert (await sam.get(f"{P}/jobs/{job['id']}")).json()["status"] == "succeeded"
    ent = next(x for x in (await sam.get(f"{P}/entities")).json() if x["id"] == ids["e-us"])
    assert ent["connection"]["lastSyncAt"] and ent["connection"]["secretRef"].endswith("••••")


async def test_recognition_policy_needs_two_people(login, ids) -> None:
    maria = await login("maria@northwind.example")
    base = f"{P}/entities/{ids['e-us']}/recognition"
    view = (await maria.get(base)).json()
    auto = [c["customer"] for c in view["contracts"] if c["column"] == "auto_applied"]
    assert "Arya Industries" in auto and "VoltGrid Networks" not in auto  # §10.1 defaults
    r = await maria.post(f"{base}/policy/propose", json={"maxPerItem": 50000, "maxPctOfRevenue": 5, "minConfidence": 0.9, "historyPeriods": 3, "aggregateCap": 100000})
    assert r.status_code == 200
    r = await maria.post(f"{base}/policy/approve", json={})
    assert r.status_code == 403 and r.json()["code"] == "sod_policy"
    grace = await login("grace@northwind.example")
    assert (await grace.post(f"{base}/policy/approve", json={})).status_code == 200
    auto = [c["customer"] for c in (await grace.get(base)).json()["contracts"] if c["column"] == "auto_applied"]
    assert "VoltGrid Networks" in auto


async def test_deferral_needs_justification(login, ids) -> None:
    priya = await login("priya@northwind.example")
    view = (await priya.get(f"{P}/entities/{ids['e-us']}/recognition")).json()
    gulf = next(c for c in view["contracts"] if c["customer"] == "Gulf Chamber Services")
    r = await priya.post(f"{P}/contracts/{gulf['id']}/decide", json={"action": "defer", "justification": "short"})
    assert r.status_code == 422 and r.json()["code"] == "justification_required"
    r = await priya.post(f"{P}/contracts/{gulf['id']}/decide", json={"action": "defer", "justification": "Signatures delayed to early September."})
    assert r.status_code == 200 and r.json()["column"] == "deferred"


async def test_accrual_approval_creates_draft(login, ids) -> None:
    priya = await login("priya@northwind.example")
    view = (await priya.get(f"{P}/entities/{ids['e-us']}/accruals")).json()
    prop = next(p for p in view["proposals"] if p["vendor"] == "CloudHost Services")
    r = (await priya.post(f"{P}/accruals/{prop['id']}/approve", json={"amount": 55200})).json()
    assert r["status"] == "approved" and r["draftId"]
    d = (await priya.get(f"{P}/je-drafts/{r['draftId']}")).json()
    assert d["type"] == "accrual" and d["totalDebit"] == d["totalCredit"] == 55200


async def test_consolidation_lock_needs_every_step(login) -> None:
    maria = await login("maria@northwind.example")
    assert (await maria.post(f"{P}/consolidation/lock", json={})).status_code == 409
    job = (await maria.post(f"{P}/consolidation/translation-run", json={})).json()
    await run_jobs()
    assert (await maria.get(f"{P}/jobs/{job['id']}")).json()["status"] == "succeeded"
    view = (await maria.get(f"{P}/consolidation")).json()
    assert next(s for s in view["steps"] if s["key"] == "translation")["done"]


async def test_copilot_streams_cited_answer(login) -> None:
    omar = await login("omar@northwind.example")
    r = await omar.post(f"{P}/copilot/ask", json={"question": "Why are we behind plan?"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    assert "event: token" in r.text and "event: done" in r.text and "critical path" in r.text
