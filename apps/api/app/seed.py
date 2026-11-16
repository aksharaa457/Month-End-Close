"""Demo seed: the fictional Northwind Holdings group used by the web app.

Run:  uv run python -m app.seed            (seeds an empty database)
      uv run python -m app.seed --reset    (wipes demo data first; dev only)

Rows go through the real constraints and triggers (balancing, SOD, period lock,
audit hash chain). AI outputs created here are labelled model_id='demo-seed'.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import random
import sys
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.audit import audit
from app.core.config import settings
from app.core.db import Db
from app.services import flux
from app.services.recognition import evaluate_contracts

NS = uuid.UUID("0b8d7b4e-5c2a-4f1e-9a63-7d2c1e4b9f10")
D = Decimal
AUG, JUL = dt.date(2026, 8, 1), dt.date(2026, 7, 1)
NOW = dt.datetime.now(dt.UTC)


def U(key: str) -> uuid.UUID:
    """Stable ids, so a re-seed gives the same URLs."""
    return uuid.uuid5(NS, key)


def ago(hours: float) -> dt.datetime:
    return NOW - dt.timedelta(hours=hours)


TENANT = U("tenant")
ENTITIES = [
    # key, name, region, erp, ccy, active, parent
    ("e-us", "Northwind Inc.", "United States", "netsuite", "USD", True, None),
    ("e-in", "Northwind Technologies India", "India", "sap", "INR", True, "e-us"),
    ("e-mefz", "Northwind Middle East FZ-LLC", "UAE", "netsuite", "AED", True, "e-us"),
    ("e-me", "Northwind Sales ME", "UAE", "sap", "AED", True, "e-us"),
    ("e-eu", "Northwind EU B.V.", "Netherlands", "sap", "EUR", False, "e-us"),
]
USERS = [
    # key, name, email, title, status, [(entity|None, role)]
    ("u-priya", "Priya Sharma", "priya@northwind.example", "Senior Accountant", "active", [(None, "preparer")]),
    ("u-omar", "Omar Haddad", "omar@northwind.example", "Accounting Manager", "active", [(None, "reviewer"), (None, "approver")]),
    ("u-daniel", "Daniel Chen", "daniel@northwind.example", "Assistant Controller", "active", [(None, "approver")]),
    ("u-maria", "Maria Lopez", "maria@northwind.example", "Group Controller", "active", [(None, "controller")]),
    ("u-grace", "Grace Okafor", "grace@northwind.example", "CFO", "active", [(None, "controller")]),
    ("u-ravi", "Ravi Kumar", "ravi@northwind.example", "Accountant, India", "active", [("e-in", "preparer"), ("e-in", "reviewer")]),
    ("u-sam", "Sam Patel", "sam@northwind.example", "Finance Systems Admin", "active", [(None, "admin")]),
    ("u-ellen", "Ellen Brooks", "ellen@auditfirm.example", "External Auditor", "active", [(None, "auditor")]),
    ("u-lena", "Lena Novak", "lena@northwind.example", "Accountant, EU", "invited", [("e-eu", "preparer")]),
]
THR = {"e-us": (25000, "USD"), "e-in": (2000000, "INR"), "e-mefz": (90000, "AED"), "e-me": (90000, "AED"), "e-eu": (23000, "EUR")}

TEMPLATES = [
    ("pre_close", "Confirm cut-off dates with all entities", "Read cut-off timestamps from each connected ledger and match them to the close calendar.", 1, None,
     "Reconciled cut-off timestamps across 14 connected systems and matched them to the close calendar. No entity's cut-off moved since last close."),
    ("pre_close", "Lock period in source system", "Confirm no postings after cut-off in the source ledger.", 1, None,
     "Verified the period lock in the ERP: 0 postings after cut-off (checked 1,284 journal headers)."),
    ("reconciliations", "AP reconciliation", "Reconcile the AP sub-ledger to the GL control account.", 2, "recon", None),
    ("reconciliations", "Fixed deposit reconciliation", "Match interest accrued and bank confirmations.", 3, "recon", None),
    ("reconciliations", "Bank reconciliation", "Reconcile bank to statements; raise unmatched items.", 3, "recon", None),
    ("accruals", "Review all accrual entries", "Review AI-detected missing accruals and booked accruals.", 3, None, None),
    ("accruals", "Controller sign-off on accrual entries", "Controller reviews and signs off the accrual schedule.", 4, None, None),
    ("intercompany", "Intercompany balance matching", "Match IC receivables/payables with counterparties.", 4, None, None),
    ("intercompany", "Confirm intercompany eliminations", "Confirm eliminations for matched balances.", 5, None, None),
    ("compliance", "Revenue recognition review (ASC 606)", "Review recognition results and gating decisions.", 4, None, None),
    ("compliance", "Statutory tax provision review", "Review indirect tax and withholding computations.", 5, None, None),
    ("compliance", "Fixed asset depreciation run", "Run depreciation and review the schedule.", 3, None, None),
    ("board_pack", "Flux commentary for board pack", "Compile signed-off variance explanations.", 6, None, None),
    ("board_pack", "CFO review of board pack", "CFO reviews the board pack before distribution.", 7, None, None),
]
PLANS = {
    "e-us": "ai ai done done done prog todo prog todo prog todo sub todo todo",
    "e-in": "ai ai done done done done prog prog todo sub todo prog todo todo",
    "e-mefz": "ai ai done done done done done prog todo prog prog sub todo todo",
    "e-me": "ai ai done done prog todo todo todo todo prog todo todo todo todo",
}
OWNERS = "priya priya priya priya priya priya maria priya maria priya priya priya priya grace".split()
REVIEWERS = "omar omar omar omar omar maria grace omar grace maria maria omar maria maria".split()


class Seeder:
    def __init__(self, db: Db):
        self.db = db
        self.acct: dict[tuple[str, str], uuid.UUID] = {}
        self.std: dict[str, uuid.UUID] = {}
        self.rnd = random.Random(20260904)
        self.explain_ids: dict[tuple[str, str], tuple[uuid.UUID, dict[str, Any] | None, str]] = {}

    async def ai(self, kind: str, txt: str, *, citations: list[dict[str, Any]] | None = None, confidence: float | None = 0.9, outcome: str = "ok", hours: float = 1, data: dict[str, Any] | None = None) -> uuid.UUID:
        row = await self.db.one(
            """INSERT INTO ai.ai_outputs (tenant_id, kind, outcome, model_id, prompt_version, input_hash, output, citations, confidence, inference_region, created_at)
               VALUES (:t, :k, :o, 'demo-seed', 'seed@1', :h, CAST(:out AS jsonb), CAST(:c AS jsonb), :conf, 'n/a', :at) RETURNING id""",
            t=TENANT, k=kind, o=outcome, h=uuid.uuid4().bytes, out={"text": txt, "data": data or {}, "contextNoteIds": []}, c=citations or [], conf=confidence, at=ago(hours),
        )
        assert row
        return row["id"]

    async def run(self) -> None:
        db = self.db
        await db.insert("tenancy.tenants", {"id": TENANT, "name": "Northwind Holdings", "workos_org_id": "org_northwind", "reporting_currency": "USD"})
        for key, name, region, erp, ccy, active, parent in ENTITIES:
            await db.insert("tenancy.entities", {"id": U(key), "name": name, "region": region, "erp_type": erp, "functional_currency": ccy,
                                                 "status": "active" if active else "setup_required", "parent_id": U(parent) if parent else None})
        for key, name, email, title, status, mems in USERS:
            await db.insert("tenancy.users", {"id": U(key), "display_name": name, "email": email, "title": title, "status": status,
                                              "workos_user_id": f"dev_{email.split('@')[0]}" if status == "active" else None})
            for ent, role in mems:
                await db.insert("tenancy.memberships", {"user_id": U(key), "entity_id": U(ent) if ent else None, "role": role})
        for key, *_rest in ENTITIES:
            active = _rest[4]
            thr, ccy = THR[key]
            await db.insert("flux.thresholds", {"entity_id": U(key), "account_class": None, "abs_amount": D(thr), "pct": D(10), "version": 1, "effective_from": dt.date(2026, 1, 1), "created_by": U("u-maria")})
            await db.insert("journals.approval_policies", {"entity_id": U(key), "second_approval_above": D(thr * 10), "currency": ccy, "version": 1, "effective_from": dt.date(2026, 1, 1), "created_by": U("u-maria")})
            await db.insert("close.periods", {"id": U(f"p-{key}"), "entity_id": U(key), "period": AUG, "target_close_day": 6})
            if active:
                await db.insert("brain.connections", {"entity_id": U(key), "erp_type": _rest[2], "secret_ref": f"arn:aws:secretsmanager:eu:000:secret:cch/{key}/erp-sim", "status": "connected",
                                                      "last_sync_at": ago(3.2 if key == "e-me" else 0.3 + self.rnd.random()), "mode": "simulated",
                                                      "last_error": "Last scheduled sync timed out (SAP OData 504). Retrying hourly." if key == "e-me" else None})
        await self.accounts_us()
        for key, scale, n in (("e-in", 80, 320), ("e-mefz", 3, 45), ("e-me", 3, 40)):
            await self.accounts_generated(key, scale, n)
        for key, *_ in ENTITIES:
            await self.sync_runs(key)
        await self.tasks()
        await self.variances()
        await self.context_notes()
        await self.drafts()
        await self.comments()
        await self.accruals()
        await self.recognition()
        await self.consolidation()
        await audit(db, "demo.seeded", "tenant", TENANT, "Demo data seeded (Northwind Holdings, Aug 2026)", actor_type="system")

    # ------------------------------------------------------------------ chart of accounts
    async def add_account(self, ent: str, code: str, name: str, cls: str, parent: str | None, prior: float = 0, current: float = 0, group: bool = False, mapped: bool = True) -> uuid.UUID:
        db = self.db
        aid = U(f"{ent}-{code}")
        std_id = None
        if mapped and not group:
            if code not in self.std:
                self.std[code] = U(f"std-{code}")
                await db.insert("brain.standard_accounts", {"id": self.std[code], "code": code, "name": name, "account_class": cls})
            std_id = self.std[code]
        await db.insert("brain.accounts", {"id": aid, "entity_id": U(ent), "erp_account_code": code, "name": name, "account_class": cls,
                                           "statement": "pl" if cls in ("revenue", "expense") else "bs",
                                           "parent_account_id": U(f"{ent}-{parent}") if parent else None, "is_group": group, "std_account_id": std_id})
        if not group:
            ccy = next(e[4] for e in ENTITIES if e[0] == ent)
            for per, amt in ((JUL, prior), (AUG, current)):
                await db.insert("brain.gl_balances", {"entity_id": U(ent), "account_id": aid, "period": per, "currency": ccy, "amount_functional": D(str(round(amt, 2)))}, returning="account_id")
        self.acct[(ent, code)] = aid
        return aid

    async def gl(self, ent: str, code: str, ref: str, date: str, amount: float, memo: str) -> dict[str, Any]:
        ccy = next(e[4] for e in ENTITIES if e[0] == ent)
        gid = U(f"gl-{ent}-{ref}")
        await self.db.insert("brain.gl_lines", {"id": gid, "entity_id": U(ent), "account_id": self.acct[(ent, code)], "period": AUG if date >= "2026-08" else JUL,
                                                "erp_line_ref": ref, "posting_date": dt.date.fromisoformat(date), "amount": D(str(amount)), "currency": ccy, "memo": memo})
        return {"recordType": "gl_line", "recordId": str(gid), "label": f"{ref} · {memo[:48]}"}

    async def accounts_us(self) -> None:
        a = self.add_account
        E = "e-us"
        await a(E, "4000", "Income", "revenue", None, group=True)
        await a(E, "4020", "Recurring Revenue", "revenue", "4000", group=True)
        await a(E, "40201001", "License / Subscription Fee", "revenue", "4020", 572199.91, 0)
        await a(E, "40201002", "Professional Fee", "revenue", "4020", 100058.34, 0)
        await a(E, "40301001", "Other Income", "revenue", "4000", 1250, 1310.4)
        await a(E, "6000", "Operating Expenses", "expense", None, group=True)
        await a(E, "60501001", "Bank Charges", "expense", "6000", 1432.51, 49.04)
        await a(E, "60701002", "Depreciation", "expense", "6000", 1570.62, 1626.04)
        await a(E, "6010", "Employee related cost", "expense", "6000", group=True)
        await a(E, "60104001", "Hiring Charges", "expense", "6010", 0, 445)
        await a(E, "60105011", "Payroll Expenses / Commissions", "expense", "6010", 188333.56, 0)
        await a(E, "60105012", "Salaries", "expense", "6010", 412880, 418200)
        await a(E, "60801001", "Company Insurance", "expense", "6000", 8091.68, 2046.47)
        await a(E, "60301004", "Cloud Hosting", "expense", "6000", 96400, 41200)
        await a(E, "6090", "Legal and professional charges", "expense", "6000", group=True)
        await a(E, "60901001", "Legal Charges", "expense", "6090", 19611.53, 2400)
        await a(E, "61001002", "Management consulting & Strategy", "expense", "6090", 56588.02, 11500)
        await a(E, "61001003", "Audit Fees", "expense", "6090", 369471.73, 369471.73)
        await a(E, "60999999", "Misc. expense (new in ERP)", "expense", "6000", 0, 1240, mapped=False)  # EC-2
        await a(E, "1000", "Assets", "asset", None, group=True)
        await a(E, "11001000", "Cash at bank", "asset", "1000", 2450000, 2180000)
        await a(E, "12001000", "Trade receivables", "asset", "1000", 1120000, 1412000)
        await a(E, "13001000", "Prepaid expenses", "asset", "1000", 11500, 11500)
        await a(E, "2000", "Liabilities", "liability", None, group=True)
        await a(E, "21001000", "Accrued liabilities", "liability", "2000", 88000, 64500)
        await a(E, "22001000", "Deferred revenue", "liability", "2000", 310000, 982258.25)
        await a(E, "23001000", "Intercompany payable", "liability", "2000", 205000, 205000)

    async def accounts_generated(self, ent: str, scale: float, leaf_count: int) -> None:
        rnd = self.rnd
        groups = [("4000", "Revenue", "revenue"), ("5000", "Cost of sales", "expense"), ("6000", "Operating expenses", "expense"), ("1000", "Assets", "asset"), ("2000", "Liabilities", "liability")]
        names = {"revenue": ["Subscription revenue", "Services revenue", "Support revenue", "Training revenue", "Usage revenue"],
                 "expense": ["Salaries", "Rent", "Software", "Travel", "Contractors", "Utilities", "Marketing", "Recruitment", "Telecom", "Office supplies"],
                 "asset": ["Bank account", "Receivables", "Prepaids", "Deposits", "Fixed assets"],
                 "liability": ["Payables", "Accruals", "Tax payable", "Deferred revenue", "Payroll liabilities"]}
        per = max(2, leaf_count // len(groups))
        for gcode, gname, cls in groups:
            await self.add_account(ent, gcode, gname, cls, None, group=True)
            sub_count = max(1, round(per / 12))
            for s in range(sub_count):
                scode = gcode
                if sub_count > 1:
                    scode = f"{gcode[:2]}{s + 1:02d}"
                    await self.add_account(ent, scode, f"{gname} — group {s + 1}", cls, gcode, group=True)
                leaves = -(-per // sub_count)
                for i in range(leaves):
                    base = names[cls][i % len(names[cls])]
                    code = f"{gcode[0]}{s + 1:02d}{i + 1:05d}"
                    prior = round((5000 + rnd.random() * 120000) * scale)
                    swing = (rnd.random() - 0.5) * 1.2 if rnd.random() < 0.12 else (rnd.random() - 0.5) * 0.12
                    suffix = f" {i // len(names[cls]) + 1}" if leaves > len(names[cls]) else ""
                    await self.add_account(ent, code, base + suffix, cls, scode, prior, max(0, round(prior * (1 + swing))))
                    if abs(swing) > 0.1:
                        ref = f"{'SAP' if ent in ('e-in', 'e-me') else 'NS'}-{code}-08"
                        cit = await self.gl(ent, code, ref, "2026-08-28", round(prior * swing), f"{base} movement")
                        aid = await self.ai("variance_explanation", f"{base} moved {'up' if swing > 0 else 'down'} {abs(swing * 100):.0f}% versus July. Most of the change comes from one posting ({ref}) on 28 Aug.", citations=[cit], confidence=round(0.8 + rnd.random() * 0.15, 3))
                        self.explain_ids[(ent, code)] = (aid, None, "auto")

    async def sync_runs(self, key: str) -> None:
        conn = await self.db.one("SELECT id FROM brain.connections WHERE entity_id = :e", e=U(key))
        if not conn:
            return
        n = await self.db.scalar("SELECT count(*) FROM brain.accounts WHERE entity_id = :e", e=U(key))
        for i, (h, status, err) in enumerate([(0.4, "failed" if key == "e-me" else "succeeded", "SAP OData gateway returned 504 after 3 retries." if key == "e-me" else None), (1.4, "succeeded", None)]):
            await self.db.insert("brain.sync_runs", {"connection_id": conn["id"], "trigger": "schedule", "status": status, "started_at": ago(h), "finished_at": ago(h - 0.05),
                                                     "stats": {"accounts": n, "lines": 1200 + i * 30}, "error": err}, returning="id")

    # ------------------------------------------------------------------ checklist
    async def tasks(self) -> None:
        db = self.db
        for key, *_rest in ENTITIES:
            plan = PLANS.get(key, " ".join(["todo"] * 14)).split()
            ids = []
            for i, (phase, title, desc, due, kind, ai_text) in enumerate(TEMPLATES):
                s = plan[i]
                owner = "ravi" if key == "e-in" and OWNERS[i] == "priya" else OWNERS[i]
                reviewer = REVIEWERS[i] if REVIEWERS[i] != owner else "maria"
                tid = U(f"t-{key}-{i + 1}")
                ids.append(tid)
                ai_id = None
                if s == "ai" and ai_text:
                    ai_id = await self.ai("task_verification", ai_text, confidence=0.97,
                                          citations=[{"recordType": "sync_run", "recordId": key, "label": f"Sync run · {'SAP' if _rest[2] == 'sap' else 'NetSuite'} · 14 systems"}])
                done = s in ("done", "ai")
                status = {"ai": "completed", "done": "completed", "prog": "in_progress", "sub": "submitted"}.get(s, "not_started")
                await db.insert("close.tasks", {
                    "id": tid, "period_id": U(f"p-{key}"), "phase": phase, "title": title, "description": desc,
                    "owner_id": U(f"u-{owner}"), "reviewer_id": U(f"u-{reviewer}"), "due_day": due, "status": status,
                    "requires_evidence": kind == "recon", "is_reconciliation": kind == "recon", "verified_by_ai": s == "ai", "ai_output_id": ai_id,
                    "submitted_by": U(f"u-{owner}") if s in ("done", "sub") else None,
                    "signed_off_by": U(f"u-{reviewer}") if s == "done" else None,
                    "completed_day": min(4, 1 + i % 4) if done else None,
                })
                subs = ([("Read the cut-off timestamp from each connected ledger", s == "ai"), ("Compare every entity against the close calendar", s == "ai"), ("Flag entities whose cut-off moved since last close", s == "ai")]
                        if i == 0 else [("Pull sub-ledger and GL balances", s != "todo"), ("Investigate and document reconciling items", s == "done"), ("Attach reconciliation workpaper", s == "done")]
                        if kind == "recon" else [("Complete the review and record conclusions", s in ("done", "sub"))])
                for j, (t, d) in enumerate(subs):
                    await db.insert("close.subtasks", {"task_id": tid, "title": t, "is_done": d, "ai_drafted": True, "sort_order": j}, returning="id")
                if kind == "recon" and done:
                    await db.insert("close.task_evidence", {"task_id": tid, "s3_key": f"{TENANT}/{tid}/workpaper.xlsx", "file_name": f"{title.replace(' ', '_')}_Aug26.xlsx",
                                                            "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "size_bytes": 48211 + i * 1000,
                                                            "sha256": uuid.uuid4().bytes * 2, "scan_status": "clean", "uploaded_by": U(f"u-{owner}"), "uploaded_at": ago(30 - i)}, returning="id")
            for i, dep in ((6, 5), (8, 7), (13, 12)):
                await db.insert("close.task_dependencies", {"task_id": ids[i], "depends_on_task_id": ids[dep]}, returning="task_id")

    # ------------------------------------------------------------------ variances
    async def variances(self) -> None:
        E = "e-us"
        g = self.gl
        c1 = await g(E, "40201001", "NS-INV-30411", "2026-07-31", 572199.91, "July subscription recognition run (auto)")
        c2 = await g(E, "40201002", "NS-INV-30412", "2026-07-31", 100058.34, "July implementation milestones recognised")
        c3 = await g(E, "60501001", "NS-BNK-8812", "2026-08-31", 49.04, "Merchant fees Aug (partial statement sync)")
        c4 = await g(E, "60105011", "NS-PAY-0731", "2026-07-31", 188333.56, "Payroll & commissions July")
        c5 = await g(E, "60301004", "NS-BILL-7781", "2026-08-31", 41200, "CloudHost invoice (partial month)")
        c6 = await g(E, "60901001", "NS-BILL-7702", "2026-08-12", 2400, "Outside counsel retainer")
        c7 = await g(E, "61001002", "NS-BILL-7690", "2026-08-20", 11500, "Strategy engagement phase 2 kickoff")
        c8 = await g(E, "11001000", "NS-BNK-9001", "2026-08-03", -268000, "Vendor payment run")
        c9 = await g(E, "12001000", "NS-INV-30455", "2026-08-28", 292000, "Annual renewal invoices")
        rec_cit = {"recordType": "contract", "recordId": str(U("k-gulf")), "label": "Gulf Chamber Services · gating: needs review", "link": f"/e/{U('e-us')}/recognition"}
        spec = [
            ("4020", "Every account under Recurring Revenue booked $672,258.25 in July and nothing in August. Revenue has not stopped: the August recognition run has not posted because contracts are still in the gating queue and the run is held until they are decided. License / Subscription Fee drives 85% of the gap and Professional Fee 15%.", [c1, c2, rec_cit], 0.88, "explained", None),
            ("40201001", "No August subscription recognition has posted. July's run (NS-INV-30411) recognised $572,199.91. The August run is held pending gating decisions.", [c1], 0.9, "explained", {"type": "correction", "amount": 354800, "offsetCode": "22001000"}),
            ("40201002", "Implementation milestones for 2 customers are awaiting client sign-off, so no professional fees were recognised in August.", [c2], 0.86, "auto", {"type": "correction", "amount": 62000, "offsetCode": "22001000"}),
            ("60501001", "Only one bank fee line ($49.04) synced for August. July had 14 merchant fee lines. The August bank statement import looks incomplete; fees are likely under-recorded by about $900.", [c3], 0.81, "auto", {"type": "reclass", "amount": 900, "offsetCode": "11001000"}),
            ("60105011", "The bi-weekly payroll voucher for August has not been posted to the ledger. July's payroll (NS-PAY-0731) was $188,333.56. Commissions for Q3 are typically accrued at month end.", [c4], 0.93, "auto", {"type": "accrual", "amount": 116800, "offsetCode": "21001000"}),
            ("60301004", "Only a partial-month hosting invoice ($41,200) is booked for August against a run-rate of about $96,000. The remaining usage is unbilled and should be accrued.", [c5, {"recordType": "accrual", "recordId": str(U("acc-cloudhost")), "label": "Accrual proposal: CloudHost Services", "link": f"/e/{U('e-us')}/accruals"}], 0.9, "auto", {"type": "accrual", "amount": 55200, "offsetCode": "21001000"}),
            ("60901001", "July included a one-off IP litigation retainer ($17,211). August shows only the standard monthly retainer.", [c6], 0.89, "auto", {"type": "reclass", "amount": 2400, "offsetCode": "61001003"}),
            ("61001002", "Phase 1 of the strategy engagement ended in July. August reflects the smaller phase 2 kickoff fee.", [c7], 0.92, "auto", None),
            ("11001000", "Cash fell $270,000, mainly from the July payroll run and vendor payments clearing on 3 Aug.", [c8], 0.87, "auto", None),
            ("12001000", "Receivables grew as annual invoices for 2 enterprise renewals were issued on 28 Aug but not yet collected.", [c9], 0.9, "auto", None),
            ("21001000", "July accruals for consulting were reversed on 1 Aug; August accruals have not been booked yet.", [], 0.84, "auto", None),
            ("22001000", "Deferred revenue rose because billings continued while the August recognition run is held in the gating queue.", [], 0.88, "auto", None),
        ]
        for code, txt, cits, conf, st, need in spec:
            aid = await self.ai("variance_explanation", txt, citations=cits, confidence=conf)
            self.explain_ids[(E, code)] = (aid, need, st)
        # insufficient data → needs manual explanation (EC-8/9)
        ins = await self.ai("variance_explanation", "The data available doesn't explain this movement: no insurance invoices or amortization entries for August were found in the synced ledger.", confidence=None, outcome="insufficient_data")
        self.explain_ids[(E, "60801001")] = (ins, None, "auto")

        for key, *_rest in ENTITIES:
            await flux.recompute(self.db, U(key))
        for (ent, code), (aid, need, st) in self.explain_ids.items():
            await self.db.exec(
                "UPDATE flux.variances SET explanation_ai_output_id = :a, needs_entry = CAST(:n AS jsonb), status = CASE WHEN is_flagged THEN :st ELSE status END WHERE account_id = :acc",
                a=aid, n=need, st="explained" if st == "explained" else "open", acc=self.acct[(ent, code)],
            )
        for key, *_rest in ENTITIES:
            await flux.recompute(self.db, U(key))

    async def context_notes(self) -> None:
        db = self.db
        acc_def, acc_ar = self.acct[("e-us", "22001000")], self.acct[("e-us", "12001000")]
        await db.insert("flux.context_notes", {"id": U("cn-1"), "scope": "account", "entity_id": U("e-us"), "account_id": acc_def,
                                               "text": "Annual contracts are billed upfront in the renewal month; expect deferred revenue to spike in renewal months.",
                                               "status": "approved", "proposed_by": U("u-priya"), "proposed_at": dt.datetime(2026, 3, 4, 10, tzinfo=dt.UTC),
                                               "decided_by": U("u-omar"), "decided_at": dt.datetime(2026, 3, 4, 15, tzinfo=dt.UTC), "review_by": dt.date(2027, 3, 4)})
        await db.insert("flux.context_notes", {"id": U("cn-2"), "scope": "account", "entity_id": U("e-us"), "account_id": acc_ar,
                                               "text": "Enterprise renewals are invoiced on the 28th and collected net-30.", "status": "pending",
                                               "proposed_by": U("u-priya"), "proposed_at": ago(20), "review_by": dt.date(2027, 9, 1),
                                               "preview_explanation": "Receivables grew because enterprise renewals were invoiced on 28 Aug and, given net-30 terms, are expected to be collected by late September. This is expected timing."})

    # ------------------------------------------------------------------ journal entries
    async def drafts(self) -> None:
        db = self.db
        E = "e-us"
        seq = [1000]

        async def mk(code: str, typ: str, amount: float, offset: str, final: str, *, approver: str | None = None, doc: str | None = None, error: str | None = None) -> None:
            seq[0] += 1
            num = f"JE-{seq[0]}"
            src = self.acct[(E, code)]
            off = self.acct[(E, offset)]
            src_row = await db.one("SELECT name, account_class FROM brain.accounts WHERE id = :a", a=src)
            assert src_row
            debit_src = src_row["account_class"] in ("expense", "asset")
            ai_id = await self.ai("je_draft", f"Drafted a {typ} of ${amount:,.2f} for {code} {src_row['name']} based on the August variance review.",
                                  citations=[{"recordType": "variance", "recordId": str(src), "label": f"{code} {src_row['name']} variance"}], hours=6)
            did = U(f"je-{num}")
            vid = await db.scalar("SELECT id FROM flux.variances WHERE account_id = :a", a=src)
            await db.insert("journals.je_drafts", {"id": did, "number": num, "period_id": U(f"p-{E}"), "je_type": typ, "source_type": "variance", "source_variance_id": vid,
                                                   "source_label": f"{code} {src_row['name']}", "description": f"{typ.capitalize()} — {code} {src_row['name']}, per Aug 2026 variance review",
                                                   "status": "draft", "created_by_ai": True, "ai_output_id": ai_id, "preparer_id": U("u-priya"), "currency": "USD",
                                                   "requires_second_approval": amount > 250000, "created_at": ago(6)})
            amt = D(str(amount))
            await db.insert("journals.je_lines", {"draft_id": did, "line_no": 1, "account_id": src if debit_src else off, "debit": amt, "credit": D(0)}, returning="id")
            await db.insert("journals.je_lines", {"draft_id": did, "line_no": 2, "account_id": off if debit_src else src, "debit": D(0), "credit": amt}, returning="id")
            await db.exec("UPDATE journals.je_drafts SET status = 'submitted' WHERE id = :d", d=did)  # balance trigger runs here
            await db.exec("UPDATE flux.variances SET needs_entry = NULL WHERE account_id = :a", a=src)
            if final == "submitted":
                return
            await db.insert("journals.approvals", {"draft_id": did, "draft_version": 1, "level": 1, "approver_id": U(f"u-{approver}"), "decision": "approved", "decided_at": ago(3)}, returning="id")
            await db.exec("UPDATE journals.je_drafts SET status = 'approved' WHERE id = :d", d=did)
            ok = final == "posted"
            await db.insert("journals.posting_attempts", {"draft_id": did, "attempt_no": 1, "idempotency_key": f"{did}:v1", "request_hash": b"seed", "status": "succeeded" if ok else "failed",
                                                          "erp_doc_number": doc, "error_message": error, "started_at": ago(2.9), "finished_at": ago(2.9)}, returning="id")
            if ok:
                await db.exec("UPDATE journals.je_drafts SET status = 'posted', erp_doc_number = :doc, posted_at = :at WHERE id = :d", doc=doc, at=ago(25.9), d=did)
            else:
                await db.exec("UPDATE journals.je_drafts SET status = 'post_failed' WHERE id = :d", d=did)

        await mk("40201001", "correction", 354800, "22001000", "submitted")
        await mk("60105011", "accrual", 116800, "21001000", "submitted")
        await mk("60501001", "reclass", 900, "11001000", "posted", approver="omar", doc="NS-JE-48211")
        await mk("60901001", "reclass", 2400, "61001003", "post_failed", approver="daniel",
                 error="NetSuite rejected the entry: posting period Aug 2026 is closed for AP/GL in the source system (EC-19). Reopen it in NetSuite, then retry.")

    async def comments(self) -> None:
        await self.db.insert("close.comments", {"subject_type": "task", "subject_id": U("t-e-us-1"), "author_id": U("u-omar"), "body": "Confirmed with the India team that their cut-off stays at 23:59 IST.", "created_at": ago(50)}, returning="id")
        await self.db.insert("close.comments", {"subject_type": "variance", "subject_id": self.acct[("e-us", "60801001")], "author_id": U("u-priya"), "body": "Asked the broker for the August premium invoice.", "created_at": ago(5)}, returning="id")

    # ------------------------------------------------------------------ v1 modules
    async def accruals(self) -> None:
        db = self.db
        cats = [("Software", 182300, 240000), ("Hosting / Cloud", 41200, 96400), ("Professional", 383371, 445671), ("Marketing", 12000, 64000), ("Travel", 11800, 21000)]
        for key, scale in (("e-us", 1), ("e-in", 80), ("e-mefz", 3.67), ("e-me", 3.67)):
            for cat, act, rr in cats:
                await db.insert("accruals.category_spend", {"entity_id": U(key), "period": AUG, "category": cat, "actual": D(round(act * scale)), "run_rate": D(round(rr * scale))}, returning="category")
        props = [
            ("acc-cloudhost", "e-us", "CloudHost Services", "Hosting / Cloud", "run_rate", 55200, "USD", "Billed every month for 18 months; August has only a partial invoice ($41,200) against a 6-month average of $96,400.", 0.92),
            ("acc-dataflake", "e-us", "DataFlake Inc.", "Software", "contract", 42500, "USD", "Annual contract billed quarterly; Q3 invoice not received, 1/3 of the quarter has elapsed.", 0.9),
            ("acc-monitorly", "e-us", "Monitorly", "Hosting / Cloud", "open_po", 18200, "USD", "Open PO 4471 for August monitoring with goods receipt and no bill.", 0.88),
            ("acc-tripstack", "e-us", "TripStack", "Travel", "run_rate", 100, "USD", "Recurring travel-booking fee missing for August.", 0.75),
            ("acc-fivora", "e-in", "Fivora Consulting LLP", "Professional charges", "contract", 300000, "INR", "Monthly retainer per signed SOW; no August invoice booked.", 0.91),
            ("acc-brightline", "e-in", "Brightline Advisory", "Professional charges", "run_rate", 264000, "INR", "Tax advisory billed monthly since March; August missing.", 0.86),
        ]
        for pid, ent, vendor, cat, basis, amt, ccy, ev, conf in props:
            ai_id = await self.ai("accrual_detection", ev, confidence=conf, citations=[{"recordType": "gl_line", "recordId": pid, "label": f"Vendor history · {vendor}"}])
            await db.insert("accruals.proposals", {"id": U(pid), "entity_id": U(ent), "period": AUG, "vendor": vendor, "category": cat, "basis": basis, "amount": D(amt), "currency": ccy, "evidence": ev, "ai_output_id": ai_id})

    async def recognition(self) -> None:
        db = self.db
        rows = [
            ("k-gulf", "Gulf Chamber Services", "C-4 / CONTRACT-1011", 36000, "recognition_trigger = signature (HubSpot)", ["No signature event for Aug 2026 recorded in HubSpot", "Schedule v1 of 1 becomes effective Oct 2026"], False, 0.62, False, "Omar Haddad"),
            ("k-easydata", "Easy Data Integration", "C-7 / CONTRACT-1042", 45432, "recognition_trigger = deployment_signoff (Jira)", ["Deployment sign-off ticket DEP-882 still open"], False, 0.58, False, "Priya Sharma"),
            ("k-crestline", "Crestline Financial", "C-12 / CONTRACT-0988", 275000, "recognition_trigger = usage_threshold (Stripe)", ["Metered usage at 64% of the monthly threshold"], False, 0.66, False, "Priya Sharma"),
            ("k-voltgrid", "VoltGrid Networks", "C-19 / CONTRACT-1102", 485000, "recognition_trigger = subscription_active (Stripe)", ["Subscription sub_8XK2 active since 1 Aug", "Licence key registered 2 Aug"], True, 0.96, False, "Priya Sharma"),
            ("k-arya", "Arya Industries", "C-23 / CONTRACT-1090", 28356, "recognition_trigger = milestone_2 (Salesforce)", ["Milestone 2 accepted by client on 12 Aug"], True, 0.95, False, "Priya Sharma"),
            ("k-rawda", "Rawda Foods", "C-29 / CONTRACT-1077", 175000, "recognition_trigger = monthly_schedule (NetSuite)", ["Recurring schedule active"], True, 0.94, False, "Priya Sharma"),
            ("k-kestrel", "Kestrel Labs", "C-31 / CONTRACT-1120", 54000, "recognition_trigger = subscription_active (Stripe)", ["Subscription active since 3 Jul"], True, 0.93, False, "Priya Sharma"),
            ("k-pinecrest", "Pinecrest Media", "C-33 / CONTRACT-1131", 30000, "recognition_trigger = signature (HubSpot)", ["Signature event 9 Aug (DocuSign envelope partially complete)"], True, 0.82, False, "Priya Sharma"),
            ("k-orbit", "Orbit Retail", "C-35 / CONTRACT-1144", 48000, "recognition_trigger = subscription_active (Stripe)", ["Subscription active; price amended 15 Aug"], True, 0.91, True, "Priya Sharma"),
            ("k-juniper", "Juniper Health", "C-38 / CONTRACT-1150", 42000, "recognition_trigger = subscription_active (Stripe)", ["Subscription active since 1 Jun"], True, 0.94, False, "Priya Sharma"),
        ]
        for kid, cust, code, arr, trig, ev, found, conf, mod, owner in rows:
            rec = ({"action": "start", "label": "Start in Aug (recommended)", "rationale": "Trigger evidence found in the source of record for August."} if found else
                   {"action": "defer", "label": "Defer to Sep (recommended)", "rationale": "No trigger event recorded for August; the schedule should start when the trigger occurs."})
            ai_id = await self.ai("recognition_recommendation", f"{rec['label']}: {rec['rationale']}", confidence=conf, citations=[{"recordType": "contract", "recordId": str(U(kid)), "label": f"{cust} · {ev[0]}"}])
            await db.insert("recognition.contracts", {"id": U(kid), "entity_id": U("e-us"), "customer": cust, "code": code, "arr": D(arr), "monthly": D(arr) / 12, "currency": "USD", "owner_name": owner,
                                                      "schedule_version": "v1 of 1", "trigger_rule": trig, "evidence": ev, "evidence_found": found, "modified_this_period": mod,
                                                      "confidence": D(str(conf)), "recommendation": rec, "ai_output_id": ai_id})
        await db.insert("recognition.auto_apply_policies", {"entity_id": U("e-us"), "version": 1, "status": "active", "enabled": True, "max_per_item": D(5000), "max_pct_revenue": D("0.5"),
                                                            "min_confidence": D("0.9"), "history_periods": 3, "aggregate_cap": D(50000), "proposed_by": U("u-maria"), "approved_by": U("u-grace")})
        await db.insert("recognition.sampling", {"entity_id": U("e-us"), "period": AUG, "sample_size": 5, "checked": 3, "errors": 0}, returning="entity_id")
        planned = [1.21, 1.24, 1.29, 1.31, 1.36, 1.41, 1.48, 1.56, 1.6, 1.64, 1.69, 1.75]
        recog = [1.2, 1.25, 1.27, 1.33, 1.35, 1.4, 1.47, 0.45, 0, 0, 0, 0]
        for m in range(12):
            await db.insert("recognition.monthly_plan", {"entity_id": U("e-us"), "month": dt.date(2026, m + 1, 1), "planned": D(round(planned[m] * 1e6)), "recognised_base": D(round(recog[m] * 1e6))}, returning="month")
        await evaluate_contracts(db, U("e-us"))

    async def consolidation(self) -> None:
        db = self.db
        await db.insert("consolidation.periods", {"period": AUG, "status": "in_progress"}, returning="period")
        for ccy, closing, avg, src in (("INR", "0.011925", "0.011978", "Group treasury rate table (31 Aug)"), ("AED", "0.272294", "0.272294", "Pegged rate"), ("EUR", "1.0851", "1.0912", "ECB reference rate")):
            await db.insert("brain.fx_rates", {"period": AUG, "from_ccy": ccy, "to_ccy": "USD", "rate_type": "closing", "rate": D(closing), "source": src}, returning="id")
            await db.insert("brain.fx_rates", {"period": AUG, "from_ccy": ccy, "to_ccy": "USD", "rate_type": "average", "rate": D(avg), "source": src}, returning="id")
        m = [
            ("ic-1", "e-us", "e-in", "receivable_payable", 120000, 120000, 1200, "matched", None, "Exact match on services recharge invoice IC-2026-08-01."),
            ("ic-2", "e-us", "e-mefz", "receivable_payable", 85000, 84220, 850, "matched", "fx", "Within tolerance. The $780 gap comes from AED revaluation at the 31 Aug closing rate."),
            ("ic-3", "e-in", "e-me", "revenue_expense", 46000, 41500, 500, "mismatch", "timing", "India invoiced $46,000 on 31 Aug; Sales ME booked only $41,500 — the second invoice (IC-IN-0832) is dated 2 Sep in Sales ME's ledger."),
            ("ic-4", "e-me", "e-mefz", "receivable_payable", 22000, 20600, 500, "mismatch", "amount", "Sales ME recorded a $1,400 management fee that FZ-LLC has not booked. Likely a missing payable in FZ-LLC."),
            ("ic-5", "e-us", "e-eu", "receivable_payable", 15000, 0, 500, "pending_counterparty", None, "Northwind EU B.V. is not connected yet (Set up required), so its side can't be matched."),
        ]
        for mid, f, t, kind, fa, ta, tol, st, cause, expl in m:
            await db.insert("consolidation.ic_matches", {"id": U(mid), "period": AUG, "from_entity_id": U(f), "to_entity_id": U(t), "kind": kind, "from_amount_usd": D(fa), "to_amount_usd": D(ta),
                                                         "tolerance": D(tol), "status": st, "likely_cause": cause, "explanation": expl})
        await db.insert("consolidation.eliminations", {"period": AUG, "ic_match_id": U("ic-1"), "description": "Eliminate IC receivable/payable · Northwind Inc. ↔ India", "amount": D(120000)}, returning="id")
        await db.insert("consolidation.eliminations", {"period": AUG, "ic_match_id": U("ic-2"), "description": "Eliminate IC receivable/payable · Northwind Inc. ↔ ME FZ-LLC", "amount": D(84220)}, returning="id")


TENANT_TABLES = [
    "jobs.jobs", "consolidation.eliminations", "consolidation.ic_matches", "consolidation.periods", "recognition.monthly_plan", "recognition.sampling",
    "recognition.auto_apply_policies", "recognition.contracts", "accruals.proposals", "accruals.category_spend", "journals.posting_attempts",
    "journals.approvals", "journals.approval_batches", "journals.je_lines", "journals.je_drafts", "journals.approval_policies", "flux.variance_context_links",
    "flux.variance_attributions", "flux.context_notes", "flux.variances", "flux.thresholds", "close.reopen_requests", "close.comments", "close.task_evidence",
    "close.subtasks", "close.task_dependencies", "close.tasks", "close.task_template_dependencies", "close.task_templates", "close.periods",
    "brain.fx_rates", "brain.gl_lines", "brain.gl_balances", "brain.accounts", "brain.standard_accounts", "brain.sync_runs", "brain.connections",
    "core.idempotency_keys", "auth.sessions", "audit.events", "ai.ai_outputs", "tenancy.memberships", "tenancy.users", "tenancy.entities", "tenancy.tenants",
]


async def seed(reset: bool = False, url: str | None = None) -> None:
    """Uses the migration (owner/superuser) connection. TRUNCATE is used for the dev
    reset because it doesn't fire the row-level insert-only triggers."""
    url = url or settings().migration_database_url.replace("+psycopg", "+asyncpg")
    eng = create_async_engine(url)
    async with eng.begin() as conn:
        if reset:
            await conn.execute(text(f"TRUNCATE {', '.join(TENANT_TABLES)} CASCADE"))
        elif (await conn.execute(text("SELECT count(*) FROM tenancy.tenants"))).scalar():
            print("Database already has data; use --reset to re-seed.")
            await eng.dispose()
            return
        await conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(TENANT)})
        await Seeder(Db(conn, TENANT)).run()
    await eng.dispose()
    print("Seeded Northwind Holdings demo data.")


if __name__ == "__main__":
    asyncio.run(seed(reset="--reset" in sys.argv))
