"""Setup: entities, ledger connections and syncs, account mapping, thresholds,
approval policies, users and roles (US-1, US-2, JE-4, S-3)."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, EmailStr, Field

from app.core.audit import audit
from app.core.auth import session
from app.core.config import settings
from app.core.db import Db
from app.core.errors import fail
from app.core.serialize import iso, num, period_key, sid, user_json
from app.jobs.queue import enqueue
from app.services import flux
from app.services.common import entity_json, entity_or_404, period
from app.services.journals import policy_json

router = APIRouter(prefix="/api/v1")

Role = Literal["preparer", "reviewer", "approver", "controller", "admin", "auditor"]
AccountClass = Literal["asset", "liability", "equity", "revenue", "expense"]


def _uuid(v: str) -> str:
    try:
        return str(uuid.UUID(v))
    except ValueError:
        raise fail(404, "Not found") from None


def _rid(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def _fmt(v: Decimal | float | int, grouping: bool = True) -> str:
    """Like JS Number.toLocaleString('en-US'): thousands separators, up to 3 decimals."""
    s = f"{float(v):,.3f}" if grouping else f"{float(v):.3f}"
    return s.rstrip("0").rstrip(".")


# ------------------------------------------------------------------ product catalog (static)
SOURCES: list[dict[str, Any]] = [
    {"id": "s1", "category": "Ledger", "name": "NetSuite", "details": "General ledger, sub-ledgers and chart of accounts via SuiteTalk REST + SuiteQL.", "status": "connected", "release": "MVP"},
    {"id": "s2", "category": "Ledger", "name": "SAP S/4HANA", "details": "Regional ledgers via OData. ECC (RFC/BAPI) support depends on PRD Q2.", "status": "connected", "release": "MVP"},
    {"id": "s3", "category": "Contracts & CRM", "name": "Salesforce", "details": "Signed deals, ARR schedules, billing terms.", "status": "available", "release": "v1"},
    {"id": "s4", "category": "Contracts & CRM", "name": "HubSpot", "details": "Deal signatures and recognition trigger events.", "status": "available", "release": "v1"},
    {"id": "s5", "category": "Billing & usage", "name": "Stripe", "details": "Subscriptions, metered usage, invoices.", "status": "available", "release": "v1"},
    {"id": "s6", "category": "Banking", "name": "Open Banking", "details": "Statements and cash positions.", "status": "available", "release": "Later"},
    {"id": "s7", "category": "Documents & budget", "name": "Google Drive / SharePoint", "details": "Budgets, board packs, contracts.", "status": "available", "release": "Later"},
    {"id": "s8", "category": "Communication", "name": "Slack", "details": "Close channels and escalations (CL-6).", "status": "available", "release": "v1"},
]
_LEDGER_ERP = {"s1": "netsuite", "s2": "sap"}


# ------------------------------------------------------------------ entities, sources, standard accounts
async def _connection(db: Db, entity_id: Any) -> dict[str, Any] | None:
    return await db.one("SELECT * FROM brain.connections WHERE entity_id = :e", e=entity_id)


@router.get("/entities")
async def list_entities(request: Request) -> list[dict[str, Any]]:
    async with session(request) as (_p, db):
        ents = await db.all("SELECT * FROM tenancy.entities WHERE status <> 'archived' ORDER BY parent_id NULLS FIRST, name")
        conns = {str(c["entity_id"]): c for c in await db.all("SELECT * FROM brain.connections")}
        return [entity_json(e, conns.get(str(e["id"]))) for e in ents]


@router.get("/sources")
async def list_sources(request: Request) -> list[dict[str, Any]]:
    async with session(request) as (_p, db):
        connected = {r["erp_type"] for r in await db.all("SELECT DISTINCT erp_type FROM brain.connections")}
        out = []
        for s in SOURCES:
            erp = _LEDGER_ERP.get(s["id"])
            out.append({**s, "status": ("connected" if erp in connected else "available") if erp else s["status"]})
        return out


@router.get("/standard-accounts")
async def standard_accounts(request: Request) -> list[dict[str, Any]]:
    async with session(request) as (_p, db):
        rows = await db.all("SELECT id, code, name, account_class FROM brain.standard_accounts ORDER BY code")
        return [{"id": str(r["id"]), "code": r["code"], "name": r["name"], "accountClass": r["account_class"]} for r in rows]


def sync_run_json(r: dict[str, Any], entity_id: Any) -> dict[str, Any]:
    stats = r["stats"] or {}
    out: dict[str, Any] = {
        "id": str(r["id"]), "entityId": str(entity_id), "trigger": r["trigger"], "status": r["status"],
        "startedAt": iso(r["started_at"]), "finishedAt": iso(r["finished_at"]),
        "stats": {"accounts": int(stats.get("accounts", 0)), "lines": int(stats.get("lines", 0))},
    }
    if r["error"]:
        out["error"] = r["error"]
    return out


@router.get("/entities/{entity_id}/sync-runs")
async def sync_runs(entity_id: str, request: Request) -> list[dict[str, Any]]:
    async with session(request) as (_p, db):
        e = await entity_or_404(db, entity_id)
        rows = await db.all(
            """SELECT r.* FROM brain.sync_runs r JOIN brain.connections c ON c.id = r.connection_id
                WHERE c.entity_id = :e ORDER BY r.started_at DESC LIMIT 200""",
            e=e["id"],
        )
        return [sync_run_json(r, e["id"]) for r in rows]


# ------------------------------------------------------------------ ledger connection + sync (US-1)
class ConnectionIn(BaseModel):
    erpType: Literal["netsuite", "sap"] = "netsuite"
    accountId: str = Field(default="", max_length=200)
    secret: str = Field(default="", max_length=4000)


@router.post("/entities/{entity_id}/connections")
async def create_connection(entity_id: str, body: ConnectionIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        e = await entity_or_404(db, entity_id)
        p.require("setup.manage", e["id"])
        if not body.accountId.strip() or not body.secret.strip():
            raise fail(422, "Missing credentials", "Enter the account ID and the integration token.")
        # The token goes to Secrets Manager; the database only ever holds its ARN (S-4).
        # Locally there is no Secrets Manager or ERP sandbox, so new connections run simulated.
        ref = f"arn:aws:secretsmanager:eu-west-1:000000000000:secret:cch/{e['id']}/erp-{uuid.uuid4().hex[:6]}"
        mode = "simulated" if settings().dev_idp else "live"
        await db.exec("UPDATE tenancy.entities SET erp_type = :t WHERE id = :id", t=body.erpType, id=e["id"])
        await db.exec(
            """INSERT INTO brain.connections (tenant_id, entity_id, erp_type, secret_ref, status, mode)
               VALUES (:tn, :e, :t, :ref, 'connected', :mode)
               ON CONFLICT (tenant_id, entity_id) DO UPDATE SET erp_type = EXCLUDED.erp_type, secret_ref = EXCLUDED.secret_ref,
                 status = 'connected', last_sync_at = NULL, last_error = NULL""",
            tn=db.tenant_id, e=e["id"], t=body.erpType, ref=ref, mode=mode,
        )
        label = "SAP" if body.erpType == "sap" else "NetSuite"
        await audit(db, "connection.created", "entity", e["id"], f"{label} connected for {e['name']}. Credentials stored in Secrets Manager.",
                    actor_id=p.id, entity_id=e["id"], request_id=_rid(request))
        e = await entity_or_404(db, e["id"])
        return entity_json(e, await _connection(db, e["id"]))


class SyncIn(BaseModel):
    backfill: bool = False


SYNC_STEPS = ["Fetching changes since last sync", "Normalising to the shared ledger model", "Recomputing variances", "Queuing AI explanations for changed lines"]
BACKFILL_STEPS = ["Reading chart of accounts", "Backfilling 13 months of balances", "Loading journal lines", "Normalising to the shared ledger model", "Recomputing variances"]


@router.post("/entities/{entity_id}/sync")
async def start_sync(entity_id: str, request: Request, body: SyncIn | None = None) -> dict[str, Any]:
    async with session(request) as (p, db):
        if not p.can("setup.manage") and not p.can("period.lock", entity_id):
            raise fail(403, "Not allowed", "Only admins and controllers can trigger a sync.")
        e = await entity_or_404(db, entity_id)
        conn = await _connection(db, e["id"])
        if not conn or conn["status"] != "connected":
            raise fail(409, "Not connected", "Connect the ledger first.")
        backfill = bool(body and body.backfill)
        kind = "backfill" if backfill else "sync"
        return await enqueue(db, kind, {"entityId": str(e["id"])}, created_by=p.id, message=(BACKFILL_STEPS if backfill else SYNC_STEPS)[0])


# ------------------------------------------------------------------ account mapping (US-2)
@router.get("/entities/{entity_id}/account-mappings")
async def account_mappings(entity_id: str, request: Request) -> list[dict[str, Any]]:
    async with session(request) as (_p, db):
        e = await entity_or_404(db, entity_id)
        rows = await db.all(
            """SELECT a.id, a.erp_account_code, a.name, a.account_class, a.std_account_id, b.amount_functional
                 FROM brain.accounts a
                 LEFT JOIN brain.gl_balances b ON b.account_id = a.id AND b.entity_id = a.entity_id AND b.period = :per
                WHERE a.entity_id = :e AND NOT a.is_group AND a.is_active
                ORDER BY (a.std_account_id IS NOT NULL), a.erp_account_code""",
            e=e["id"], per=period(),
        )
        return [
            {"accountId": str(r["id"]), "entityId": str(e["id"]), "erpCode": r["erp_account_code"], "name": r["name"], "accountClass": r["account_class"],
             "stdAccountId": sid(r["std_account_id"]), "balance": num(r["amount_functional"]) or 0.0}
            for r in rows
        ]


class MappingIn(BaseModel):
    accountId: str
    stdAccountId: str | None = None


@router.put("/entities/{entity_id}/account-mappings")
async def set_mapping(entity_id: str, body: MappingIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        e = await entity_or_404(db, entity_id)
        p.require("setup.manage", e["id"])
        try:
            acct_id = str(uuid.UUID(body.accountId))
        except ValueError:
            raise fail(404, "Account not found") from None
        a = await db.one("SELECT * FROM brain.accounts WHERE id = :a AND entity_id = :e", a=acct_id, e=e["id"])
        if not a:
            raise fail(404, "Account not found")
        std = None
        if body.stdAccountId:
            try:
                std = await db.one("SELECT id, code FROM brain.standard_accounts WHERE id = :s", s=str(uuid.UUID(body.stdAccountId)))
            except ValueError:
                std = None
            if not std:
                raise fail(422, "Unknown standard account")
        await db.exec("UPDATE brain.accounts SET std_account_id = :s WHERE id = :a", s=std["id"] if std else None, a=a["id"])
        await audit(db, "account.mapped", "account", a["id"], f"{a['erp_account_code']} {a['name']} mapped to {std['code'] if std else 'nothing'}",
                    actor_id=p.id, entity_id=e["id"], request_id=_rid(request))
        return {"ok": True}


# ------------------------------------------------------------------ thresholds (FX-2; versioned, never overwritten)
def threshold_json(t: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(t["id"]), "entityId": str(t["entity_id"]), "accountClass": t["account_class"],
        "absAmount": num(t["abs_amount"]), "pct": num(t["pct"]), "version": t["version"],
        "effectiveFrom": period_key(t["effective_from"]), "createdBy": str(t["created_by"]), "createdAt": iso(t["created_at"]),
    }


@router.get("/entities/{entity_id}/thresholds")
async def list_thresholds(entity_id: str, request: Request) -> list[dict[str, Any]]:
    async with session(request) as (_p, db):
        e = await entity_or_404(db, entity_id)
        rows = await db.all("SELECT * FROM flux.thresholds WHERE entity_id = :e ORDER BY version DESC, account_class NULLS FIRST, created_at DESC", e=e["id"])
        return [threshold_json(t) for t in rows]


class ThresholdIn(BaseModel):
    accountClass: AccountClass | None = None
    absAmount: Decimal
    pct: Decimal


@router.post("/entities/{entity_id}/thresholds")
async def add_threshold(entity_id: str, body: ThresholdIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        e = await entity_or_404(db, entity_id)
        p.require("thresholds.manage", e["id"])
        abs_amt, pct = body.absAmount, body.pct
        if not abs_amt.is_finite() or not pct.is_finite() or abs_amt < 0 or pct < 0 or pct > 100:
            raise fail(422, "Invalid threshold", "Amount must be ≥ 0 and percentage between 0 and 100.")
        version = await db.scalar(
            "SELECT coalesce(max(version), 0) + 1 FROM flux.thresholds WHERE entity_id = :e AND account_class IS NOT DISTINCT FROM CAST(:c AS text)",
            e=e["id"], c=body.accountClass,
        )
        t = await db.insert("flux.thresholds", {"entity_id": e["id"], "account_class": body.accountClass, "abs_amount": abs_amt, "pct": pct,
                                                "version": version, "effective_from": period(), "created_by": p.id})
        scope = f"for {body.accountClass}" if body.accountClass else "(default)"
        await audit(db, "threshold.versioned", "threshold", t["id"], f"Materiality threshold v{version}: {_fmt(abs_amt)} / {_fmt(pct, False)}% {scope}",
                    actor_id=p.id, entity_id=e["id"], request_id=_rid(request))
        if await db.scalar("SELECT 1 FROM close.periods WHERE entity_id = :e AND period = :per", e=e["id"], per=period()):
            if await flux.recompute(db, e["id"]):  # skips a locked period
                # Newly flagged lines get an AI explanation in the background.
                await enqueue(db, "explain", {"entityId": str(e["id"])}, created_by=p.id, message="Explaining newly flagged lines")
        return threshold_json(t)


# ------------------------------------------------------------------ approval policy (JE-4; versioned)
@router.get("/entities/{entity_id}/approval-policies")
async def list_policies(entity_id: str, request: Request) -> list[dict[str, Any]]:
    async with session(request) as (_p, db):
        e = await entity_or_404(db, entity_id)
        rows = await db.all("SELECT * FROM journals.approval_policies WHERE entity_id = :e ORDER BY version DESC", e=e["id"])
        return [policy_json(r) for r in rows]


class PolicyIn(BaseModel):
    secondApprovalAbove: Decimal


@router.post("/entities/{entity_id}/approval-policies")
async def add_policy(entity_id: str, body: PolicyIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        e = await entity_or_404(db, entity_id)
        p.require("thresholds.manage", e["id"])
        amt = body.secondApprovalAbove
        if not amt.is_finite() or amt < 0:
            raise fail(422, "Invalid amount")
        prev = await db.one("SELECT * FROM journals.approval_policies WHERE entity_id = :e ORDER BY version DESC LIMIT 1", e=e["id"])
        currency = prev["currency"].strip() if prev else e["functional_currency"].strip()
        version = (prev["version"] if prev else 0) + 1
        row = await db.insert("journals.approval_policies", {"entity_id": e["id"], "second_approval_above": amt, "currency": currency,
                                                             "version": version, "effective_from": period(), "created_by": p.id})
        await audit(db, "approval_policy.versioned", "approval_policy", row["id"], f"Second approval required above {_fmt(amt)} {currency} (v{version})",
                    actor_id=p.id, entity_id=e["id"], request_id=_rid(request))
        return policy_json(row)


# ------------------------------------------------------------------ users & roles (S-3)
async def _memberships(db: Db, user_id: Any = None) -> dict[str, list[dict[str, Any]]]:
    rows = await db.all(
        "SELECT id, user_id, entity_id, role FROM tenancy.memberships WHERE revoked_at IS NULL AND (CAST(:u AS uuid) IS NULL OR user_id = :u) ORDER BY granted_at, id",
        u=user_id,
    )
    out: dict[str, list[dict[str, Any]]] = {}
    for m in rows:
        out.setdefault(str(m["user_id"]), []).append(m)
    return out


async def _user_out(db: Db, user_id: Any) -> dict[str, Any]:
    u = await db.one("SELECT * FROM tenancy.users WHERE id = :id", id=user_id)
    assert u
    return user_json(u, (await _memberships(db, user_id)).get(str(user_id), []))


async def _user_or_404(db: Db, user_id: str) -> dict[str, Any]:
    try:
        uid = str(uuid.UUID(user_id))
    except ValueError:
        uid = None
    u = await db.one("SELECT * FROM tenancy.users WHERE id = :id", id=uid) if uid else None
    if not u:
        raise fail(404, "User not found")
    return u


async def _check_entity(db: Db, entity_id: uuid.UUID | None) -> None:
    if entity_id and not await db.scalar("SELECT 1 FROM tenancy.entities WHERE id = :e", e=entity_id):
        raise fail(422, "Unknown entity", "The membership refers to an entity that doesn't exist.")


@router.get("/users")
async def list_users(request: Request) -> list[dict[str, Any]]:
    async with session(request) as (_p, db):
        users = await db.all("SELECT * FROM tenancy.users ORDER BY created_at, display_name")
        mems = await _memberships(db)
        return [user_json(u, mems.get(str(u["id"]), [])) for u in users]


class InviteIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=200)
    title: str = Field(default="", max_length=200)
    role: Role
    entityId: uuid.UUID | None = None


@router.post("/users")
async def invite_user(body: InviteIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        p.require("setup.manage")
        email = str(body.email).strip().lower()
        name = body.name.strip()
        if not name:
            raise fail(422, "Invalid request", "name: Enter a name.", "validation")
        if await db.scalar("SELECT 1 FROM tenancy.users WHERE lower(email) = :e", e=email):
            raise fail(409, "Already invited", "A user with this email already exists.")
        await _check_entity(db, body.entityId)
        u = await db.insert("tenancy.users", {"email": email, "display_name": name, "title": body.title.strip(), "status": "invited"})
        await db.insert("tenancy.memberships", {"user_id": u["id"], "entity_id": body.entityId, "role": body.role, "granted_by": p.id}, returning="id")
        await audit(db, "user.invited", "user", u["id"], f"{name} invited as {body.role}", actor_id=p.id, request_id=_rid(request))
        return await _user_out(db, u["id"])


class MembershipIn(BaseModel):
    entityId: uuid.UUID | None = None
    role: Role


class MembershipsIn(BaseModel):
    memberships: list[MembershipIn] = Field(default_factory=list, max_length=100)


@router.put("/users/{user_id}/memberships")
async def set_memberships(user_id: str, body: MembershipsIn, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        p.require("setup.manage")
        u = await _user_or_404(db, user_id)
        if u["id"] == p.id:
            raise fail(403, "Not allowed", "You can't change your own roles.", "sod_self_roles")
        wanted: list[MembershipIn] = []
        seen: set[tuple[Any, str]] = set()
        for m in body.memberships:
            if (m.entityId, m.role) not in seen:
                seen.add((m.entityId, m.role))
                wanted.append(m)
        for m in wanted:
            await _check_entity(db, m.entityId)
        await db.exec("UPDATE tenancy.memberships SET revoked_at = now() WHERE user_id = :u AND revoked_at IS NULL", u=u["id"])
        for m in wanted:
            await db.insert("tenancy.memberships", {"user_id": u["id"], "entity_id": m.entityId, "role": m.role, "granted_by": p.id}, returning="id")
        roles = ", ".join(m.role for m in wanted) or "none"
        await audit(db, "user.roles_changed", "user", u["id"], f"Roles for {u['display_name']}: {roles}", actor_id=p.id, request_id=_rid(request))
        return await _user_out(db, u["id"])


@router.post("/users/{user_id}/deactivate")
async def deactivate_user(user_id: str, request: Request) -> dict[str, Any]:
    async with session(request) as (p, db):
        p.require("setup.manage")
        u = await _user_or_404(db, user_id)
        if u["id"] == p.id:
            raise fail(403, "Not allowed", "You can't deactivate yourself.")
        await db.exec("UPDATE tenancy.users SET status = 'deactivated' WHERE id = :id", id=u["id"])
        await db.scalar("SELECT auth.revoke_user_sessions(:id)", id=u["id"])
        await audit(db, "user.deactivated", "user", u["id"], f"{u['display_name']} deactivated (SCIM). All sessions revoked.", actor_id=p.id, request_id=_rid(request))
        return await _user_out(db, u["id"])
