"""The controls the PRD and ARCHITECTURE say must never break (§8 security risks)."""

from __future__ import annotations

import uuid

import httpx
import psycopg
import pytest

from tests.conftest import HOST, TEST_DB, run_jobs

P = "/api/v1"


def superuser() -> psycopg.Connection:
    return psycopg.connect(f"postgresql://postgres:postgres@{HOST}/{TEST_DB}", autocommit=True)


async def drafts(c: httpx.AsyncClient, eid: str) -> list[dict]:
    return (await c.get(f"{P}/entities/{eid}/periods/2026-08/je-drafts")).json()["drafts"]


# ------------------------------------------------------------------ authentication & CSRF
async def test_requires_session() -> None:
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(f"{P}/me")
    assert r.status_code == 401
    assert r.headers["content-type"].startswith("application/problem+json")


async def test_unprovisioned_user_refused(login) -> None:
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        r = await c.post(f"{P}/auth/callback", json={"email": "stranger@other.example"})
    assert r.status_code == 403
    assert r.json()["code"] == "not_provisioned"


async def test_invited_user_activates_on_first_sign_in(login) -> None:
    c = await login("lena@northwind.example")
    me = (await c.get(f"{P}/me")).json()
    assert me["user"]["status"] == "active"


async def test_writes_need_csrf_header(login, ids) -> None:
    c = await login("priya@northwind.example")
    c.headers.pop("X-CSRF-Token")
    r = await c.post(f"{P}/comments", json={"subjectType": "task", "subjectId": str(uuid.uuid4()), "body": "x"})
    assert r.status_code == 403 and r.json()["code"] == "csrf"


async def test_logout_revokes_session(login) -> None:
    c = await login("priya@northwind.example")
    assert (await c.post(f"{P}/auth/logout")).status_code == 200
    c.cookies.clear()
    assert (await c.get(f"{P}/me")).status_code == 401


# ------------------------------------------------------------------ tenant isolation (S-1)
async def test_rls_hides_other_tenants_rows(login, ids) -> None:
    other = uuid.uuid4()
    with superuser() as db:
        db.execute("INSERT INTO tenancy.tenants (id, name, workos_org_id) VALUES (%s, 'Other Co', %s)", (other, f"org_{other}"))
        db.execute("INSERT INTO tenancy.entities (tenant_id, name, erp_type, functional_currency) VALUES (%s, 'Other Entity', 'sap', 'EUR')", (other,))
    c = await login("maria@northwind.example")
    summary = (await c.get(f"{P}/close/summary")).json()
    assert "Other Entity" not in [e["entityName"] for e in summary["entities"]]
    # The app role, with a tenant set, can't see the other tenant at the database level either.
    from app.core.db import tenant_tx

    async with tenant_tx(await _tenant_id(c)) as db:
        assert await db.scalar("SELECT count(*) FROM tenancy.entities WHERE tenant_id = :t", t=other) == 0
    async with tenant_tx(other) as db:
        assert await db.scalar("SELECT count(*) FROM tenancy.entities WHERE name = 'Northwind Inc.'") == 0


async def _tenant_id(c: httpx.AsyncClient) -> str:
    return (await c.get(f"{P}/me")).json()["tenant"]["id"]


# ------------------------------------------------------------------ segregation of duties (S-5)
async def test_preparer_cannot_approve_own_entry(login, ids) -> None:
    maria = await login("maria@northwind.example")  # controller: has je.prepare AND je.approve
    d = (await maria.post(f"{P}/entities/{ids['e-us']}/periods/2026-08/je-drafts", json={"description": "SOD test"})).json()
    lines = await _two_lines(maria, ids)
    d = (await maria.patch(f"{P}/je-drafts/{d['id']}", json={"version": d["version"], "lines": lines})).json()
    assert (await maria.post(f"{P}/je-drafts/{d['id']}/submit", json={})).status_code == 200
    r = await maria.post(f"{P}/je-drafts/{d['id']}/approve", json={"version": d["version"]})
    assert r.status_code == 403 and r.json()["code"] == "sod_preparer"


async def test_second_approver_must_differ(login, ids) -> None:
    omar = await login("omar@northwind.example")
    big = next(d for d in await drafts(omar, ids["e-us"]) if d["number"] == "JE-1001")
    assert big["requiresSecondApproval"]
    assert (await omar.post(f"{P}/je-drafts/{big['id']}/approve", json={"version": big["version"]})).status_code == 200
    r = await omar.post(f"{P}/je-drafts/{big['id']}/approve", json={"version": big["version"]})
    assert r.status_code == 403 and r.json()["code"] == "sod_second_approver"
    daniel = await login("daniel@northwind.example")
    r = await daniel.post(f"{P}/je-drafts/{big['id']}/approve", json={"version": big["version"]})
    assert r.status_code == 200 and r.json()["status"] == "approved"
    await run_jobs()
    posted = next(d for d in await drafts(daniel, ids["e-us"]) if d["number"] == "JE-1001")
    assert posted["status"] == "posted" and posted["erpDocNumber"]


async def test_stale_version_refused(login, ids) -> None:
    omar = await login("omar@northwind.example")
    d = next(d for d in await drafts(omar, ids["e-us"]) if d["status"] == "submitted")
    r = await omar.post(f"{P}/je-drafts/{d['id']}/approve", json={"version": d["version"] + 5})
    assert r.status_code == 409 and r.json()["code"] == "stale_version"


async def test_database_blocks_sod_even_if_api_is_bypassed(ids) -> None:
    """Defence in depth: the trigger refuses a preparer's approval row."""
    with superuser() as db:
        d = db.execute("SELECT id, preparer_id, version, tenant_id FROM journals.je_drafts WHERE status = 'submitted' LIMIT 1").fetchone()
        assert d
        with pytest.raises(psycopg.errors.CheckViolation):
            db.execute(
                "INSERT INTO journals.approvals (tenant_id, draft_id, draft_version, level, approver_id, decision) VALUES (%s, %s, %s, 1, %s, 'approved')",
                (d[3], d[0], d[2], d[1]),
            )


# ------------------------------------------------------------------ journal integrity (JE-6)
async def test_unbalanced_entry_cannot_be_submitted(login, ids) -> None:
    priya = await login("priya@northwind.example")
    d = (await priya.post(f"{P}/entities/{ids['e-us']}/periods/2026-08/je-drafts", json={"description": "Unbalanced"})).json()
    lines = await _two_lines(priya, ids)
    lines[1]["credit"] = "50.00"
    d = (await priya.patch(f"{P}/je-drafts/{d['id']}", json={"version": d["version"], "lines": lines})).json()
    r = await priya.post(f"{P}/je-drafts/{d['id']}/submit", json={})
    assert r.status_code == 422 and r.json()["code"] == "unbalanced"


async def test_posting_is_idempotent(login, ids) -> None:
    from app.core.db import tenant_tx
    from app.services.journals import post_draft

    omar = await login("omar@northwind.example")
    posted = next(d for d in await drafts(omar, ids["e-us"]) if d["status"] == "posted")
    async with tenant_tx(await _tenant_id(omar), kind="worker") as db:
        again = await post_draft(db, posted["id"])
    assert again == {"status": "posted", "erpDocNumber": posted["erpDocNumber"]}
    with superuser() as db:
        n = db.execute("SELECT count(*) FROM journals.posting_attempts WHERE draft_id = %s AND status = 'succeeded'", (posted["id"],)).fetchone()
    assert n and n[0] == 1


async def test_idempotency_key_replays_and_rejects_reuse(login, ids) -> None:
    priya = await login("priya@northwind.example")
    task = (await priya.get(f"{P}/entities/{ids['e-us']}/periods/2026-08/tasks")).json()[0]
    h = {"Idempotency-Key": f"k-{uuid.uuid4()}"}
    r1 = await priya.post(f"{P}/comments", json={"subjectType": "task", "subjectId": task["id"], "body": "once"}, headers=h)
    r2 = await priya.post(f"{P}/comments", json={"subjectType": "task", "subjectId": task["id"], "body": "once"}, headers=h)
    assert r1.json()["id"] == r2.json()["id"] and r2.headers.get("Idempotent-Replay") == "true"
    r3 = await priya.post(f"{P}/comments", json={"subjectType": "task", "subjectId": task["id"], "body": "different"}, headers=h)
    assert r3.status_code == 422 and r3.json()["code"] == "idempotency_conflict"


# ------------------------------------------------------------------ period lock (§10 item 7)
async def test_lock_refused_until_gates_met(login, ids) -> None:
    maria = await login("maria@northwind.example")
    r = await maria.post(f"{P}/entities/{ids['e-us']}/periods/2026-08/lock")
    assert r.status_code == 409 and r.json()["code"] == "gates_unmet"


async def test_locked_period_rejects_changes(login, ids) -> None:
    with superuser() as db:
        db.execute("UPDATE close.periods SET status = 'locked', locked_at = now(), locked_by = %s WHERE entity_id = %s", (ids["u-maria"], ids["e-in"]))
    ravi = await login("ravi@northwind.example")
    task = (await ravi.get(f"{P}/entities/{ids['e-in']}/periods/2026-08/tasks")).json()[0]
    r = await ravi.post(f"{P}/tasks/{task['id']}/subtasks", json={"title": "late change"})
    assert r.status_code == 409 and r.json()["code"] == "period_locked"


# ------------------------------------------------------------------ AI context tiers (§10.2)
async def test_context_note_needs_someone_else_and_right_tier(login, ids) -> None:
    priya = await login("priya@northwind.example")
    flux = (await priya.get(f"{P}/entities/{ids['e-us']}/periods/2026-08/variances")).json()
    rec = next(v for v in flux["variances"] if v["accountName"] == "Recurring Revenue")
    note = (await priya.post(f"{P}/variances/{rec['id']}/context-notes", json={"text": "billing occurs every 45 days"})).json()
    assert note["status"] == "pending" and note["previewExplanation"] and note["changesMaterialConclusion"]
    assert (await priya.post(f"{P}/context-notes/{note['id']}/approve", json={})).json()["code"] == "sod_context"
    omar = await login("omar@northwind.example")  # reviewer: account tier only, but this note is material
    assert (await omar.post(f"{P}/context-notes/{note['id']}/approve", json={})).status_code == 403
    maria = await login("maria@northwind.example")
    assert (await maria.post(f"{P}/context-notes/{note['id']}/approve", json={})).json()["status"] == "approved"
    v = (await maria.get(f"{P}/variances/{rec['id']}")).json()
    assert v["status"] == "explained" and note["id"] in v["explanation"]["contextNoteIds"]


# ------------------------------------------------------------------ audit trail (S-6)
async def test_audit_rows_cannot_be_changed(ids) -> None:
    with superuser() as db, pytest.raises(psycopg.errors.InsufficientPrivilege):
        db.execute("UPDATE audit.events SET summary = 'tampered'")


async def test_audit_chain_links(ids) -> None:
    with superuser() as db:
        rows = db.execute("SELECT prev_hash, hash FROM audit.events ORDER BY id").fetchall()
    assert len(rows) > 3
    assert all(rows[i][0] == rows[i - 1][1] for i in range(1, len(rows)))


# ------------------------------------------------------------------ helpers
async def _two_lines(c: httpx.AsyncClient, ids: dict[str, str]) -> list[dict]:
    flux = (await c.get(f"{P}/entities/{ids['e-us']}/periods/2026-08/variances")).json()
    leaves = [v["id"] for v in flux["variances"] if not v["isGroup"]][:2]
    return [{"accountId": leaves[0], "debit": "100.00", "credit": "0"}, {"accountId": leaves[1], "debit": "0", "credit": "100.00"}]
