/**
 * In-browser mock database for the demo. Shapes follow DATABASE.md; derived
 * views (variances, summaries, totals) are computed in views.ts, never stored.
 * State persists to localStorage so a refresh keeps the demo's progress.
 */
import type {
  AccountClass,
  AiOutput,
  ApprovalPolicy,
  AuditEvent,
  AutoApplyPolicy,
  Comment,
  ContextNote,
  Contract,
  Elimination,
  Entity,
  ErpType,
  FxRate,
  IcMatch,
  JeDraft,
  Phase,
  PostingAttempt,
  ReopenRequest,
  Source,
  StandardAccount,
  SyncRun,
  Task,
  Threshold,
  User,
  AccrualProposal,
  Approval,
} from "@/shared/api/types";

export const DEMO = {
  period: "2026-08",
  priorPeriod: "2026-07",
  today: "2026-09-04",
  closeDay: 4,
  modelId: "claude-opus-5-5",
  promptVersion: "flux-explain@3",
  region: "global",
};

export interface AccountRow {
  id: string;
  entityId: string;
  code: string;
  name: string;
  accountClass: AccountClass;
  statement: "pl" | "bs";
  parentId: string | null;
  isGroup: boolean;
  stdAccountId: string | null;
  prior: number; // leaf balances only; groups are summed
  current: number;
}

export interface VarianceMeta {
  status: "auto" | "needs_manual" | "explained" | "signed_off" | "exception";
  explanationId: string | null;
  signedOffBy: string | null;
  exceptionReason: string | null;
  changedAfterSignoff: boolean;
  version: number;
  needsEntry: { type: "correction" | "reclass" | "accrual"; amount: number; offsetCode: string } | null;
}

export interface GlLine {
  id: string;
  entityId: string;
  accountId: string;
  ref: string;
  postingDate: string;
  amount: number;
  memo: string;
}

export interface PeriodRow {
  id: string;
  entityId: string;
  period: string;
  status: "open" | "locked";
  targetCloseDay: number;
  lockedAt: string | null;
  lockedBy: string | null;
  reopenRequests: ReopenRequest[];
}

export type TaskRow = Omit<Task, "overdue" | "aiVerification"> & { aiVerificationId: string | null; completedDay: number | null; description: string };
export type DraftRow = Omit<JeDraft, "aiOutput" | "totalDebit" | "totalCredit" | "approvals" | "postingAttempts"> & {
  aiOutputId: string | null;
  approvals: Approval[];
  postingAttempts: PostingAttempt[];
};

export interface State {
  schema: number;
  session: { userId: string; authTime: string } | null;
  tenant: { id: string; name: string; reportingCurrency: string };
  users: User[];
  entities: Entity[];
  sources: Source[];
  stdAccounts: StandardAccount[];
  accounts: AccountRow[];
  varianceMeta: Record<string, VarianceMeta>; // by accountId
  glLines: GlLine[];
  periods: PeriodRow[];
  tasks: TaskRow[];
  comments: Comment[];
  aiOutputs: AiOutput[];
  contextNotes: ContextNote[];
  thresholds: Threshold[];
  approvalPolicies: ApprovalPolicy[];
  drafts: DraftRow[];
  draftSeq: number;
  syncRuns: SyncRun[];
  audit: AuditEvent[];
  accruals: AccrualProposal[];
  contracts: Contract[];
  autoApply: AutoApplyPolicy[];
  consolidation: {
    status: "not_started" | "in_progress" | "locked";
    translationRun: boolean;
    reviewed: boolean;
    rates: FxRate[];
    matches: IcMatch[];
    eliminations: Elimination[];
  };
}

// ------------------------------------------------------------------ helpers
let counter = 0;
export function newId(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;

export function ai(partial: Partial<AiOutput> & Pick<AiOutput, "kind" | "text">): AiOutput {
  return {
    id: newId("ai"),
    outcome: "ok",
    modelId: DEMO.modelId,
    promptVersion: partial.kind === "variance_explanation" ? DEMO.promptVersion : `${partial.kind}@1`,
    citations: [],
    confidence: 0.9,
    inferenceRegion: DEMO.region,
    createdAt: hoursAgo(1),
    dataAsOf: hoursAgo(0.3),
    contextNoteIds: [],
    ...partial,
  };
}

// ------------------------------------------------------------------ seed
export function seed(): State {
  const rnd = mulberry32(20260904);

  const users: User[] = [
    { id: "u-priya", name: "Priya Sharma", email: "priya@northwind.example", title: "Senior Accountant", status: "active", memberships: [{ id: "m1", entityId: null, role: "preparer" }] },
    { id: "u-omar", name: "Omar Haddad", email: "omar@northwind.example", title: "Accounting Manager", status: "active", memberships: [{ id: "m2", entityId: null, role: "reviewer" }, { id: "m3", entityId: null, role: "approver" }] },
    { id: "u-daniel", name: "Daniel Chen", email: "daniel@northwind.example", title: "Assistant Controller", status: "active", memberships: [{ id: "m4", entityId: null, role: "approver" }] },
    { id: "u-maria", name: "Maria Lopez", email: "maria@northwind.example", title: "Group Controller", status: "active", memberships: [{ id: "m5", entityId: null, role: "controller" }] },
    { id: "u-grace", name: "Grace Okafor", email: "grace@northwind.example", title: "CFO", status: "active", memberships: [{ id: "m6", entityId: null, role: "controller" }] },
    { id: "u-ravi", name: "Ravi Kumar", email: "ravi@northwind.example", title: "Accountant, India", status: "active", memberships: [{ id: "m7", entityId: "e-in", role: "preparer" }, { id: "m8", entityId: "e-in", role: "reviewer" }] },
    { id: "u-sam", name: "Sam Patel", email: "sam@northwind.example", title: "Finance Systems Admin", status: "active", memberships: [{ id: "m9", entityId: null, role: "admin" }] },
    { id: "u-ellen", name: "Ellen Brooks", email: "ellen@auditfirm.example", title: "External Auditor", status: "active", memberships: [{ id: "m10", entityId: null, role: "auditor" }] },
    { id: "u-lena", name: "Lena Novak", email: "lena@northwind.example", title: "Accountant, EU", status: "invited", memberships: [{ id: "m11", entityId: "e-eu", role: "preparer" }] },
  ];

  const ent = (id: string, name: string, region: string, erpType: ErpType, ccy: string, active: boolean, parentId: string | null): Entity => ({
    id,
    name,
    region,
    erpType,
    functionalCurrency: ccy,
    status: active ? "active" : "setup_required",
    ownershipPct: 100,
    parentId,
    connection: active
      ? { status: "connected", lastSyncAt: hoursAgo(0.3 + rnd()), lastError: null, secretRef: `arn:aws:secretsmanager:…:secret:cch/${id}/erp-••••` }
      : { status: "pending", lastSyncAt: null, lastError: null, secretRef: null },
  });
  const entities: Entity[] = [
    ent("e-us", "Northwind Inc.", "United States", "netsuite", "USD", true, null),
    ent("e-in", "Northwind Technologies India", "India", "sap", "INR", true, "e-us"),
    ent("e-mefz", "Northwind Middle East FZ-LLC", "UAE", "netsuite", "AED", true, "e-us"),
    ent("e-me", "Northwind Sales ME", "UAE", "sap", "AED", true, "e-us"),
    ent("e-eu", "Northwind EU B.V.", "Netherlands", "sap", "EUR", false, "e-us"),
  ];
  // one sync warning for demo of freshness alerts (EC-1)
  entities[3].connection.lastSyncAt = hoursAgo(3.2);
  entities[3].connection.lastError = "Last scheduled sync timed out (SAP OData 504). Retrying hourly.";

  const sources: Source[] = [
    { id: "s1", category: "Ledger", name: "NetSuite", details: "General ledger, sub-ledgers and chart of accounts via SuiteTalk REST + SuiteQL.", status: "connected", release: "MVP" },
    { id: "s2", category: "Ledger", name: "SAP S/4HANA", details: "Regional ledgers via OData. ECC (RFC/BAPI) support depends on PRD Q2.", status: "connected", release: "MVP" },
    { id: "s3", category: "Contracts & CRM", name: "Salesforce", details: "Signed deals, ARR schedules, billing terms.", status: "available", release: "v1" },
    { id: "s4", category: "Contracts & CRM", name: "HubSpot", details: "Deal signatures and recognition trigger events.", status: "available", release: "v1" },
    { id: "s5", category: "Billing & usage", name: "Stripe", details: "Subscriptions, metered usage, invoices.", status: "available", release: "v1" },
    { id: "s6", category: "Banking", name: "Open Banking", details: "Statements and cash positions.", status: "available", release: "Later" },
    { id: "s7", category: "Documents & budget", name: "Google Drive / SharePoint", details: "Budgets, board packs, contracts.", status: "available", release: "Later" },
    { id: "s8", category: "Communication", name: "Slack", details: "Close channels and escalations (CL-6).", status: "available", release: "v1" },
  ];

  // ---------------------------------------------------------------- chart of accounts
  const stdAccounts: StandardAccount[] = [];
  const accounts: AccountRow[] = [];
  const varianceMeta: Record<string, VarianceMeta> = {};
  const glLines: GlLine[] = [];
  const aiOutputs: AiOutput[] = [];

  const std = (code: string, name: string, cls: AccountClass) => {
    let s = stdAccounts.find((x) => x.code === code);
    if (!s) {
      s = { id: `std-${code}`, code, name, accountClass: cls };
      stdAccounts.push(s);
    }
    return s.id;
  };

  const add = (entityId: string, code: string, name: string, cls: AccountClass, parentId: string | null, prior = 0, current = 0, isGroup = false, mapped = true) => {
    const id = `${entityId}-${code}`;
    accounts.push({
      id,
      entityId,
      code,
      name,
      accountClass: cls,
      statement: cls === "revenue" || cls === "expense" ? "pl" : "bs",
      parentId,
      isGroup,
      stdAccountId: mapped && !isGroup ? std(code, name, cls) : null,
      prior: round2(prior),
      current: round2(current),
    });
    return id;
  };

  // --- Northwind Inc. (detailed demo data, USD)
  const E = "e-us";
  const inc = add(E, "4000", "Income", "revenue", null, 0, 0, true);
  const rec = add(E, "4020", "Recurring Revenue", "revenue", inc, 0, 0, true);
  const lic = add(E, "40201001", "License / Subscription Fee", "revenue", rec, 572199.91, 0);
  const prof = add(E, "40201002", "Professional Fee", "revenue", rec, 100058.34, 0);
  add(E, "40301001", "Other Income", "revenue", inc, 1250, 1310.4);
  const opex = add(E, "6000", "Operating Expenses", "expense", null, 0, 0, true);
  const bank = add(E, "60501001", "Bank Charges", "expense", opex, 1432.51, 49.04);
  add(E, "60701002", "Depreciation", "expense", opex, 1570.62, 1626.04);
  const emp = add(E, "6010", "Employee related cost", "expense", opex, 0, 0, true);
  add(E, "60104001", "Hiring Charges", "expense", emp, 0, 445);
  const payroll = add(E, "60105011", "Payroll Expenses / Commissions", "expense", emp, 188333.56, 0);
  add(E, "60105012", "Salaries", "expense", emp, 412880, 418200);
  const ins = add(E, "60801001", "Company Insurance", "expense", opex, 8091.68, 2046.47);
  const host = add(E, "60301004", "Cloud Hosting", "expense", opex, 96400, 41200);
  const legalGrp = add(E, "6090", "Legal and professional charges", "expense", opex, 0, 0, true);
  const legal = add(E, "60901001", "Legal Charges", "expense", legalGrp, 19611.53, 2400);
  const cons = add(E, "61001002", "Management consulting & Strategy", "expense", legalGrp, 56588.02, 11500);
  add(E, "61001003", "Audit Fees", "expense", legalGrp, 369471.73, 369471.73);
  add(E, "60999999", "Misc. expense (new in ERP)", "expense", opex, 0, 1240, false, false); // unmapped → blocks lock (EC-2)
  const assets = add(E, "1000", "Assets", "asset", null, 0, 0, true);
  const cash = add(E, "11001000", "Cash at bank", "asset", assets, 2450000, 2180000);
  const ar = add(E, "12001000", "Trade receivables", "asset", assets, 1120000, 1412000);
  add(E, "13001000", "Prepaid expenses", "asset", assets, 11500, 11500);
  const liab = add(E, "2000", "Liabilities", "liability", null, 0, 0, true);
  const accr = add(E, "21001000", "Accrued liabilities", "liability", liab, 88000, 64500);
  const defrev = add(E, "22001000", "Deferred revenue", "liability", liab, 310000, 982258.25);
  add(E, "23001000", "Intercompany payable", "liability", liab, 205000, 205000);

  const gl = (accountId: string, ref: string, date: string, amount: number, memo: string) => {
    const id = `gl-${ref}`;
    glLines.push({ id, entityId: accountId.split("-").slice(0, 2).join("-"), accountId, ref, postingDate: date, amount, memo });
    return { recordType: "gl_line" as const, recordId: id, label: `${ref} · ${memo.slice(0, 48)}` };
  };

  const explain = (_accountId: string, text: string, citations: AiOutput["citations"], confidence = 0.91, outcome: AiOutput["outcome"] = "ok") => {
    const o = ai({ kind: "variance_explanation", text, citations, confidence, outcome });
    aiOutputs.push(o);
    return o.id;
  };

  const c1 = gl(lic, "NS-INV-30411", "2026-07-31", 572199.91, "July subscription recognition run (auto)");
  const c2 = gl(prof, "NS-INV-30412", "2026-07-31", 100058.34, "July implementation milestones recognised");
  const meta = (accountId: string, m: Partial<VarianceMeta>) => {
    varianceMeta[accountId] = {
      status: "auto",
      explanationId: null,
      signedOffBy: null,
      exceptionReason: null,
      changedAfterSignoff: false,
      version: 1,
      needsEntry: null,
      ...m,
    };
  };
  meta(rec, {
    explanationId: explain(
      rec,
      "Every account under Recurring Revenue booked $672,258.25 in July and nothing in August. Revenue has not stopped: the August recognition run has not posted because 3 contracts are still in the gating queue and the run is held until they are decided. License / Subscription Fee drives 85% of the gap and Professional Fee 15%.",
      [c1, c2, { recordType: "contract", recordId: "k-gulf", label: "Gulf Chamber Services · gating: needs review", link: "/recognition" }],
      0.88,
    ),
    status: "explained",
  });
  meta(lic, { explanationId: explain(lic, "No August subscription recognition has posted. July's run (NS-INV-30411) recognised $572,199.91. The August run is held pending 3 gating decisions.", [c1], 0.9), status: "explained", needsEntry: { type: "correction", amount: 354800, offsetCode: "22001000" } });
  meta(prof, { explanationId: explain(prof, "Implementation milestones for 2 customers are awaiting client sign-off, so no professional fees were recognised in August.", [c2], 0.86), needsEntry: { type: "correction", amount: 62000, offsetCode: "22001000" } });
  const c3 = gl(bank, "NS-BNK-8812", "2026-08-31", 49.04, "Merchant fees Aug (partial statement sync)");
  meta(bank, { explanationId: explain(bank, "Only one bank fee line ($49.04) synced for August. July had 14 merchant fee lines. The August bank statement import looks incomplete; fees are likely under-recorded by about $900.", [c3], 0.81), needsEntry: { type: "reclass", amount: 900, offsetCode: "11001000" } });
  const c4 = gl(payroll, "NS-PAY-0731", "2026-07-31", 188333.56, "Payroll & commissions July");
  meta(payroll, { explanationId: explain(payroll, "The bi-weekly payroll voucher for August has not been posted to the ledger. July's payroll (NS-PAY-0731) was $188,333.56. Commissions for Q3 are typically accrued at month end.", [c4], 0.93), needsEntry: { type: "accrual", amount: 116800, offsetCode: "21001000" } });
  meta(ins, { explanationId: explain(ins, "The data available doesn't explain this movement: no insurance invoices or amortization entries for August were found in the synced ledger.", [], null as unknown as number, "insufficient_data"), status: "needs_manual" });
  const c5 = gl(host, "NS-BILL-7781", "2026-08-31", 41200, "CloudHost invoice (partial month)");
  meta(host, { explanationId: explain(host, "Only a partial-month hosting invoice ($41,200) is booked for August against a run-rate of about $96,000. The remaining usage is unbilled and should be accrued.", [c5, { recordType: "accrual", recordId: "acc-cloudhost", label: "Accrual proposal: CloudHost Services", link: "/accruals" }], 0.9), needsEntry: { type: "accrual", amount: 55200, offsetCode: "21001000" } });
  const c6 = gl(legal, "NS-BILL-7702", "2026-08-12", 2400, "Outside counsel retainer");
  meta(legal, { explanationId: explain(legal, "July included a one-off IP litigation retainer ($17,211). August shows only the standard monthly retainer.", [c6], 0.89), needsEntry: { type: "reclass", amount: 2400, offsetCode: "61001003" } });
  const c7 = gl(cons, "NS-BILL-7690", "2026-08-20", 11500, "Strategy engagement phase 2 kickoff");
  meta(cons, { explanationId: explain(cons, "Phase 1 of the strategy engagement ended in July. August reflects the smaller phase 2 kickoff fee.", [c7], 0.92) });
  meta(cash, { explanationId: explain(cash, "Cash fell $270,000, mainly from the July payroll run and vendor payments clearing on 3 Aug.", [gl(cash, "NS-BNK-9001", "2026-08-03", -268000, "Vendor payment run")], 0.87) });
  meta(ar, { explanationId: explain(ar, "Receivables grew as annual invoices for 2 enterprise renewals were issued on 28 Aug but not yet collected.", [gl(ar, "NS-INV-30455", "2026-08-28", 292000, "Annual renewal invoices")], 0.9) });
  meta(accr, { explanationId: explain(accr, "July accruals for consulting were reversed on 1 Aug; August accruals have not been booked yet.", [], 0.84) });
  meta(defrev, { explanationId: explain(defrev, "Deferred revenue rose because billings continued while the August recognition run is held in the gating queue.", [{ recordType: "variance", recordId: rec, label: "Recurring Revenue variance" }], 0.88) });

  // --- generated entities
  const genEntity = (entityId: string, scale: number, leafCount: number) => {
    const groups: [string, string, AccountClass][] = [
      ["4000", "Revenue", "revenue"],
      ["5000", "Cost of sales", "expense"],
      ["6000", "Operating expenses", "expense"],
      ["1000", "Assets", "asset"],
      ["2000", "Liabilities", "liability"],
    ];
    const names: Record<AccountClass, string[]> = {
      revenue: ["Subscription revenue", "Services revenue", "Support revenue", "Training revenue", "Usage revenue"],
      expense: ["Salaries", "Rent", "Software", "Travel", "Contractors", "Utilities", "Marketing", "Recruitment", "Telecom", "Office supplies"],
      asset: ["Bank account", "Receivables", "Prepaids", "Deposits", "Fixed assets"],
      liability: ["Payables", "Accruals", "Tax payable", "Deferred revenue", "Payroll liabilities"],
      equity: ["Share capital"],
    };
    const per = Math.max(2, Math.floor(leafCount / groups.length));
    for (const [gcode, gname, cls] of groups) {
      const gid = add(entityId, gcode, gname, cls, null, 0, 0, true);
      const subCount = Math.max(1, Math.round(per / 12));
      for (let s = 0; s < subCount; s++) {
        const sid = subCount > 1 ? add(entityId, `${gcode.slice(0, 2)}${String(s + 1).padStart(2, "0")}`, `${gname} — group ${s + 1}`, cls, gid, 0, 0, true) : gid;
        const leaves = Math.ceil(per / subCount);
        for (let i = 0; i < leaves; i++) {
          const base = names[cls][i % names[cls].length];
          const code = `${gcode.slice(0, 1)}${String(s + 1).padStart(2, "0")}${String(i + 1).padStart(5, "0")}`;
          const prior = Math.round((5000 + rnd() * 120000) * scale);
          const swing = rnd() < 0.12 ? (rnd() - 0.5) * 1.2 : (rnd() - 0.5) * 0.12;
          const acctId = add(entityId, code, `${base}${leaves > names[cls].length ? ` ${Math.floor(i / names[cls].length) + 1}` : ""}`, cls, sid, prior, Math.max(0, Math.round(prior * (1 + swing))));
          if (Math.abs(swing) > 0.1) {
            const ref = `${entityId === "e-in" ? "SAP" : "NS"}-${code}-08`;
            const cit = gl(acctId, ref, "2026-08-28", Math.round(prior * swing), `${base} movement`);
            meta(acctId, {
              explanationId: explain(acctId, `${base} moved ${swing > 0 ? "up" : "down"} ${Math.abs(swing * 100).toFixed(0)}% versus July. Most of the change comes from one posting (${ref}) on 28 Aug.`, [cit], 0.8 + rnd() * 0.15),
            });
          }
        }
      }
    }
  };
  genEntity("e-in", 80, 320); // INR, ~320 accounts (virtualised flux tree)
  genEntity("e-mefz", 3, 45);
  genEntity("e-me", 3, 40);

  // ---------------------------------------------------------------- periods & tasks
  const periods: PeriodRow[] = entities.map((e) => ({
    id: `p-${e.id}-2026-08`,
    entityId: e.id,
    period: DEMO.period,
    status: "open",
    targetCloseDay: 6,
    lockedAt: null,
    lockedBy: null,
    reopenRequests: [],
  }));

  type Tpl = [Phase, string, string, number, { recon?: boolean; ai?: string }?];
  const templates: Tpl[] = [
    ["pre_close", "Confirm cut-off dates with all entities", "Read cut-off timestamps from each connected ledger and match them to the close calendar.", 1, { ai: "Reconciled cut-off timestamps across 14 connected systems and matched them to the close calendar. No entity's cut-off moved since last close." }],
    ["pre_close", "Lock period in source system", "Confirm no postings after cut-off in the source ledger.", 1, { ai: "Verified the period lock in the ERP: 0 postings after cut-off (checked 1,284 journal headers)." }],
    ["reconciliations", "AP reconciliation", "Reconcile the AP sub-ledger to the GL control account.", 2, { recon: true }],
    ["reconciliations", "Fixed deposit reconciliation", "Match interest accrued and bank confirmations.", 3, { recon: true }],
    ["reconciliations", "Bank reconciliation", "Reconcile bank to statements; raise unmatched items.", 3, { recon: true }],
    ["accruals", "Review all accrual entries", "Review AI-detected missing accruals and booked accruals.", 3],
    ["accruals", "Controller sign-off on accrual entries", "Controller reviews and signs off the accrual schedule.", 4],
    ["intercompany", "Intercompany balance matching", "Match IC receivables/payables with counterparties.", 4],
    ["intercompany", "Confirm intercompany eliminations", "Confirm eliminations for matched balances.", 5],
    ["compliance", "Revenue recognition review (ASC 606)", "Review recognition results and gating decisions.", 4],
    ["compliance", "Statutory tax provision review", "Review indirect tax and withholding computations.", 5],
    ["compliance", "Fixed asset depreciation run", "Run depreciation and review the schedule.", 3],
    ["board_pack", "Flux commentary for board pack", "Compile signed-off variance explanations.", 6],
    ["board_pack", "CFO review of board pack", "CFO reviews the board pack before distribution.", 7],
  ];

  const statusPlan: Record<string, ("done" | "ai" | "prog" | "sub" | "todo")[]> = {
    "e-us": ["ai", "ai", "done", "done", "done", "prog", "todo", "prog", "todo", "prog", "todo", "sub", "todo", "todo"],
    "e-in": ["ai", "ai", "done", "done", "done", "done", "prog", "prog", "todo", "sub", "todo", "prog", "todo", "todo"],
    "e-mefz": ["ai", "ai", "done", "done", "done", "done", "done", "prog", "todo", "prog", "prog", "sub", "todo", "todo"],
    "e-me": ["ai", "ai", "done", "done", "prog", "todo", "todo", "todo", "todo", "prog", "todo", "todo", "todo", "todo"],
  };
  const owners = ["u-priya", "u-priya", "u-priya", "u-priya", "u-priya", "u-priya", "u-maria", "u-priya", "u-maria", "u-priya", "u-priya", "u-priya", "u-priya", "u-grace"];
  const reviewers = ["u-omar", "u-omar", "u-omar", "u-omar", "u-omar", "u-maria", "u-grace", "u-omar", "u-grace", "u-maria", "u-maria", "u-omar", "u-maria", "u-maria"];

  const tasks: TaskRow[] = [];
  for (const e of entities) {
    const period = periods.find((p) => p.entityId === e.id)!;
    const plan = statusPlan[e.id];
    templates.forEach(([phase, title, description, dueDay, opts], i) => {
      const s = plan ? plan[i] : "todo";
      const id = `t-${e.id}-${i + 1}`;
      const owner = e.id === "e-in" && owners[i] === "u-priya" ? "u-ravi" : owners[i];
      const reviewer = e.id === "e-in" && reviewers[i] === "u-omar" ? "u-omar" : reviewers[i];
      let aiVerificationId: string | null = null;
      if (s === "ai" && opts?.ai) {
        const o = ai({
          kind: "task_verification",
          text: opts.ai,
          confidence: 0.97,
          citations: [{ recordType: "sync_run", recordId: `sync-${e.id}`, label: `Sync run · ${e.erpType === "sap" ? "SAP" : "NetSuite"} · 14 systems` }],
        });
        aiOutputs.push(o);
        aiVerificationId = o.id;
      }
      const subtasks =
        i === 0
          ? [
              { id: `${id}-s1`, title: "Read the cut-off timestamp from each connected ledger", isDone: s === "ai", aiDrafted: true, removed: false },
              { id: `${id}-s2`, title: "Compare every entity against the close calendar", isDone: s === "ai", aiDrafted: true, removed: false },
              { id: `${id}-s3`, title: "Flag entities whose cut-off moved since last close", isDone: s === "ai", aiDrafted: true, removed: false },
            ]
          : opts?.recon
            ? [
                { id: `${id}-s1`, title: "Pull sub-ledger and GL balances", isDone: s !== "todo", aiDrafted: true, removed: false },
                { id: `${id}-s2`, title: "Investigate and document reconciling items", isDone: s === "done", aiDrafted: true, removed: false },
                { id: `${id}-s3`, title: "Attach reconciliation workpaper", isDone: s === "done", aiDrafted: true, removed: false },
              ]
            : [{ id: `${id}-s1`, title: "Complete the review and record conclusions", isDone: s === "done" || s === "sub", aiDrafted: true, removed: false }];
      const done = s === "done" || s === "ai";
      tasks.push({
        id,
        entityId: e.id,
        periodId: period.id,
        phase,
        title,
        description,
        ownerId: owner,
        reviewerId: owner === reviewer ? "u-maria" : reviewer,
        dueDay,
        status: s === "ai" || s === "done" ? "completed" : s === "prog" ? "in_progress" : s === "sub" ? "submitted" : "not_started",
        requiresEvidence: !!opts?.recon,
        isReconciliation: !!opts?.recon,
        verifiedByAi: s === "ai",
        aiVerificationId,
        subtasks,
        evidence:
          opts?.recon && done
            ? [{ id: `${id}-ev1`, fileName: `${title.replace(/\s+/g, "_")}_Aug26.xlsx`, sizeBytes: 48211 + i * 1000, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", scanStatus: "clean", uploadedBy: owner, uploadedAt: hoursAgo(30 - i) }]
            : [],
        submittedBy: s === "done" || s === "sub" ? owner : null,
        signedOffBy: s === "done" ? (owner === reviewer ? "u-maria" : reviewer) : null,
        dependsOn: i === 6 ? [`t-${e.id}-6`] : i === 8 ? [`t-${e.id}-8`] : i === 13 ? [`t-${e.id}-13`] : [],
        version: 1,
        completedDay: done ? Math.min(DEMO.closeDay, 1 + (i % 4)) : null,
      });
    });
  }

  // ---------------------------------------------------------------- comments
  const comments: Comment[] = [
    { id: "cm1", subjectType: "task", subjectId: "t-e-us-1", authorId: "u-omar", body: "Confirmed with the India team that their cut-off stays at 23:59 IST.", createdAt: hoursAgo(50) },
    { id: "cm2", subjectType: "variance", subjectId: `${E}-60801001`, authorId: "u-priya", body: "Asked the broker for the August premium invoice.", createdAt: hoursAgo(5) },
  ];

  // ---------------------------------------------------------------- thresholds & policies
  const thrMeta: Record<string, [number, string]> = { "e-us": [25000, "USD"], "e-in": [2000000, "INR"], "e-mefz": [90000, "AED"], "e-me": [90000, "AED"], "e-eu": [23000, "EUR"] };
  const thresholds: Threshold[] = entities.map((e) => ({
    id: `thr-${e.id}-1`,
    entityId: e.id,
    accountClass: null,
    absAmount: thrMeta[e.id][0],
    pct: 10,
    version: 1,
    effectiveFrom: "2026-01",
    createdBy: "u-maria",
    createdAt: "2026-01-02T09:00:00.000Z",
  }));
  const approvalPolicies: ApprovalPolicy[] = entities.map((e) => ({
    id: `ap-${e.id}-1`,
    entityId: e.id,
    secondApprovalAbove: thrMeta[e.id][0] * 10,
    currency: e.functionalCurrency,
    version: 1,
    effectiveFrom: "2026-01",
  }));

  // ---------------------------------------------------------------- context notes
  const contextNotes: ContextNote[] = [
    {
      id: "cn-1",
      scope: "account",
      entityId: E,
      accountId: defrev,
      accountLabel: "22001000 · Deferred revenue",
      text: "Annual contracts are billed upfront in the renewal month; expect deferred revenue to spike in renewal months.",
      status: "approved",
      proposedBy: "u-priya",
      proposedAt: "2026-03-04T10:00:00.000Z",
      decidedBy: "u-omar",
      decidedAt: "2026-03-04T15:00:00.000Z",
      reviewBy: "2027-03-04",
      changesMaterialConclusion: false,
      version: 1,
      appliedToVarianceIds: [defrev],
      previewExplanation: null,
    },
    {
      id: "cn-2",
      scope: "account",
      entityId: E,
      accountId: ar,
      accountLabel: "12001000 · Trade receivables",
      text: "Enterprise renewals are invoiced on the 28th and collected net-30.",
      status: "pending",
      proposedBy: "u-priya",
      proposedAt: hoursAgo(20),
      decidedBy: null,
      decidedAt: null,
      reviewBy: "2027-09-01",
      changesMaterialConclusion: false,
      version: 1,
      appliedToVarianceIds: [],
      previewExplanation: "Receivables grew because enterprise renewals were invoiced on 28 Aug and, given net-30 terms, are expected to be collected by late September. This is expected timing.",
    },
  ];

  // ---------------------------------------------------------------- JE drafts
  const drafts: DraftRow[] = [];
  let seq = 1000;
  const mkDraft = (
    entityId: string,
    sourceAccountId: string,
    type: DraftRow["type"],
    amount: number,
    offsetCode: string,
    status: DraftRow["status"],
    extra: Partial<DraftRow> = {},
  ) => {
    seq += 1;
    const src = accounts.find((a) => a.id === sourceAccountId)!;
    const off = accounts.find((a) => a.entityId === entityId && a.code === offsetCode)!;
    const debitSource = src.accountClass === "expense" || src.accountClass === "asset";
    const o = ai({
      kind: "je_draft",
      text: `Drafted a ${type} of ${amount.toLocaleString("en-US", { style: "currency", currency: "USD" })} for ${src.code} ${src.name} based on the August variance review.`,
      citations: [{ recordType: "variance", recordId: src.id, label: `${src.code} ${src.name} variance` }],
      confidence: 0.9,
    });
    aiOutputs.push(o);
    const policy = approvalPolicies.find((p) => p.entityId === entityId)!;
    const d: DraftRow = {
      id: `je-${seq}`,
      number: `JE-${seq}`,
      entityId,
      periodId: `p-${entityId}-2026-08`,
      type,
      sourceType: "variance",
      sourceId: src.id,
      sourceLabel: `${src.code} ${src.name}`,
      description: `${type[0].toUpperCase()}${type.slice(1)} — ${src.code} ${src.name}, per Aug 2026 variance review`,
      status,
      createdByAi: true,
      aiOutputId: o.id,
      preparerId: status === "draft" ? null : "u-priya",
      currency: "USD",
      lines: [
        { id: `jl-${seq}-1`, lineNo: 1, accountId: debitSource ? src.id : off.id, accountCode: debitSource ? src.code : off.code, accountName: debitSource ? src.name : off.name, debit: amount, credit: 0, memo: "" },
        { id: `jl-${seq}-2`, lineNo: 2, accountId: debitSource ? off.id : src.id, accountCode: debitSource ? off.code : src.code, accountName: debitSource ? off.name : src.name, debit: 0, credit: amount, memo: "" },
      ],
      requiresSecondApproval: amount > policy.secondApprovalAbove,
      version: 1,
      approvals: [],
      postingAttempts: [],
      erpDocNumber: null,
      sourceChanged: false,
      createdAt: hoursAgo(6),
      ...extra,
    };
    drafts.push(d);
    return d;
  };
  mkDraft(E, lic, "correction", 354800, "22001000", "submitted");
  const p1 = mkDraft(E, payroll, "accrual", 116800, "21001000", "submitted");
  p1.approvals = [];
  mkDraft(E, bank, "reclass", 900, "11001000", "posted", {
    approvals: [{ id: "apr-1", level: 1, approverId: "u-omar", decision: "approved", draftVersion: 1, comment: null, decidedAt: hoursAgo(26), batchId: null }],
    postingAttempts: [{ attemptNo: 1, status: "succeeded", erpDocNumber: "NS-JE-48211", error: null, at: hoursAgo(25.9) }],
    erpDocNumber: "NS-JE-48211",
  });
  mkDraft(E, legal, "reclass", 2400, "61001003", "post_failed", {
    approvals: [{ id: "apr-2", level: 1, approverId: "u-daniel", decision: "approved", draftVersion: 1, comment: null, decidedAt: hoursAgo(3), batchId: null }],
    postingAttempts: [{ attemptNo: 1, status: "failed", erpDocNumber: null, error: "NetSuite rejected the entry: posting period Aug 2026 is closed for AP/GL in the source system (EC-19). Reopen it in NetSuite, then retry.", at: hoursAgo(2.9) }],
  });
  // drafts already created mean those variances shouldn't be re-drafted
  for (const d of drafts) if (d.sourceId && varianceMeta[d.sourceId]) varianceMeta[d.sourceId].needsEntry = null;

  // ---------------------------------------------------------------- sync runs
  const syncRuns: SyncRun[] = entities
    .filter((e) => e.status === "active")
    .flatMap((e, i) => [
      { id: `sync-${e.id}`, entityId: e.id, trigger: "schedule" as const, status: e.id === "e-me" ? ("failed" as const) : ("succeeded" as const), startedAt: hoursAgo(0.4 + i * 0.1), finishedAt: hoursAgo(0.35 + i * 0.1), stats: { accounts: accounts.filter((a) => a.entityId === e.id).length, lines: 1200 + i * 310 }, error: e.id === "e-me" ? "SAP OData gateway returned 504 after 3 retries." : undefined },
      { id: `sync-${e.id}-prev`, entityId: e.id, trigger: "schedule" as const, status: "succeeded" as const, startedAt: hoursAgo(1.4 + i * 0.1), finishedAt: hoursAgo(1.35 + i * 0.1), stats: { accounts: accounts.filter((a) => a.entityId === e.id).length, lines: 1180 + i * 300 } },
    ]);

  // ---------------------------------------------------------------- v1 accruals
  const accrual = (id: string, entityId: string, vendor: string, category: string, basis: AccrualProposal["basis"], amount: number, currency: string, evidence: string, conf: number): AccrualProposal => {
    const o = ai({ kind: "accrual_detection", text: evidence, confidence: conf, citations: [{ recordType: "gl_line", recordId: `gl-${id}`, label: `Vendor history · ${vendor}` }] });
    aiOutputs.push(o);
    return { id, entityId, vendor, category, basis, amount, currency, evidence, status: "suggested", dismissReason: null, draftId: null, ai: o };
  };
  const accruals: AccrualProposal[] = [
    accrual("acc-cloudhost", "e-us", "CloudHost Services", "Hosting / Cloud", "run_rate", 55200, "USD", "Billed every month for 18 months; August has only a partial invoice ($41,200) against a 6-month average of $96,400.", 0.92),
    accrual("acc-dataflake", "e-us", "DataFlake Inc.", "Software", "contract", 42500, "USD", "Annual contract billed quarterly; Q3 invoice not received, 1/3 of the quarter has elapsed.", 0.9),
    accrual("acc-monitorly", "e-us", "Monitorly", "Hosting / Cloud", "open_po", 18200, "USD", "Open PO 4471 for August monitoring with goods receipt and no bill.", 0.88),
    accrual("acc-tripstack", "e-us", "TripStack", "Travel", "run_rate", 100, "USD", "Recurring travel-booking fee missing for August.", 0.75),
    accrual("acc-fivora", "e-in", "Fivora Consulting LLP", "Professional charges", "contract", 300000, "INR", "Monthly retainer per signed SOW; no August invoice booked.", 0.91),
    accrual("acc-brightline", "e-in", "Brightline Advisory", "Professional charges", "run_rate", 264000, "INR", "Tax advisory billed monthly since March; August missing.", 0.86),
  ];

  // ---------------------------------------------------------------- v1 recognition
  const k = (id: string, customer: string, code: string, arr: number, trigger: string, evidence: string[], evidenceFound: boolean, confidence: number, modified = false, owner = "Priya Sharma"): Contract => ({
    id,
    entityId: "e-us",
    customer,
    code,
    arr,
    monthly: round2(arr / 12),
    currency: "USD",
    owner,
    scheduleVersion: "v1 of 1",
    trigger,
    evidence,
    evidenceFound,
    modifiedThisPeriod: modified,
    confidence,
    column: "needs_review",
    recommendation: evidenceFound
      ? { action: "start", label: "Start in Aug (recommended)", rationale: "Trigger evidence found in the source of record for August." }
      : { action: "defer", label: "Defer to Sep (recommended)", rationale: "No trigger event recorded for August; the schedule should start when the trigger occurs." },
    policyChecks: [],
    decision: null,
    batchSignedOff: false,
  });
  const contracts: Contract[] = [
    k("k-gulf", "Gulf Chamber Services", "C-4 / CONTRACT-1011", 36000, "recognition_trigger = signature (HubSpot)", ["No signature event for Aug 2026 recorded in HubSpot", "Schedule v1 of 1 becomes effective Oct 2026"], false, 0.62, false, "Omar Haddad"),
    k("k-easydata", "Easy Data Integration", "C-7 / CONTRACT-1042", 45432, "recognition_trigger = deployment_signoff (Jira)", ["Deployment sign-off ticket DEP-882 still open"], false, 0.58),
    k("k-crestline", "Crestline Financial", "C-12 / CONTRACT-0988", 275000, "recognition_trigger = usage_threshold (Stripe)", ["Metered usage at 64% of the monthly threshold"], false, 0.66),
    k("k-voltgrid", "VoltGrid Networks", "C-19 / CONTRACT-1102", 485000, "recognition_trigger = subscription_active (Stripe)", ["Subscription sub_8XK2 active since 1 Aug", "Licence key registered 2 Aug"], true, 0.96),
    k("k-arya", "Arya Industries", "C-23 / CONTRACT-1090", 28356, "recognition_trigger = milestone_2 (Salesforce)", ["Milestone 2 accepted by client on 12 Aug"], true, 0.95),
    k("k-rawda", "Rawda Foods", "C-29 / CONTRACT-1077", 175000, "recognition_trigger = monthly_schedule (NetSuite)", ["Recurring schedule active"], true, 0.94),
    k("k-kestrel", "Kestrel Labs", "C-31 / CONTRACT-1120", 54000, "recognition_trigger = subscription_active (Stripe)", ["Subscription active since 3 Jul"], true, 0.93),
    k("k-pinecrest", "Pinecrest Media", "C-33 / CONTRACT-1131", 30000, "recognition_trigger = signature (HubSpot)", ["Signature event 9 Aug (DocuSign envelope partially complete)"], true, 0.82),
    k("k-orbit", "Orbit Retail", "C-35 / CONTRACT-1144", 48000, "recognition_trigger = subscription_active (Stripe)", ["Subscription active; price amended 15 Aug"], true, 0.91, true),
    k("k-juniper", "Juniper Health", "C-38 / CONTRACT-1150", 42000, "recognition_trigger = subscription_active (Stripe)", ["Subscription active since 1 Jun"], true, 0.94),
  ];
  const autoApply: AutoApplyPolicy[] = [
    {
      entityId: "e-us",
      enabled: true,
      version: 1,
      maxPerItem: 5000,
      maxPctOfRevenue: 0.5,
      minConfidence: 0.9,
      historyPeriods: 3,
      aggregateCap: 50000,
      pendingChange: null,
      sampling: { sampleSize: 5, checked: 3, errors: 0, errorRatePct: 0 },
    },
  ];

  // ---------------------------------------------------------------- v1 consolidation
  const rates: FxRate[] = [
    { ccy: "INR", closing: 0.011925, average: 0.011978, source: "Group treasury rate table (31 Aug)" },
    { ccy: "AED", closing: 0.272294, average: 0.272294, source: "Pegged rate" },
    { ccy: "EUR", closing: 1.0851, average: 1.0912, source: "ECB reference rate" },
  ];
  const matches: IcMatch[] = [
    { id: "ic-1", fromEntityId: "e-us", toEntityId: "e-in", kind: "receivable_payable", fromAmountUsd: 120000, toAmountUsd: 120000, difference: 0, tolerance: 1200, status: "matched", likelyCause: null, explanation: "Exact match on services recharge invoice IC-2026-08-01.", trueUpDraftId: null },
    { id: "ic-2", fromEntityId: "e-us", toEntityId: "e-mefz", kind: "receivable_payable", fromAmountUsd: 85000, toAmountUsd: 84220, difference: 780, tolerance: 850, status: "matched", likelyCause: "fx", explanation: "Within tolerance. The $780 gap comes from AED revaluation at the 31 Aug closing rate.", trueUpDraftId: null },
    { id: "ic-3", fromEntityId: "e-in", toEntityId: "e-me", kind: "revenue_expense", fromAmountUsd: 46000, toAmountUsd: 41500, difference: 4500, tolerance: 500, status: "mismatch", likelyCause: "timing", explanation: "India invoiced $46,000 on 31 Aug; Sales ME booked only $41,500 — the second invoice (IC-IN-0832) is dated 2 Sep in Sales ME's ledger.", trueUpDraftId: null },
    { id: "ic-4", fromEntityId: "e-me", toEntityId: "e-mefz", kind: "receivable_payable", fromAmountUsd: 22000, toAmountUsd: 20600, difference: 1400, tolerance: 500, status: "mismatch", likelyCause: "amount", explanation: "Sales ME recorded a $1,400 management fee that FZ-LLC has not booked. Likely a missing payable in FZ-LLC.", trueUpDraftId: null },
    { id: "ic-5", fromEntityId: "e-us", toEntityId: "e-eu", kind: "receivable_payable", fromAmountUsd: 15000, toAmountUsd: 0, difference: 15000, tolerance: 500, status: "pending_counterparty", likelyCause: null, explanation: "Northwind EU B.V. is not connected yet (Set up required), so its side can't be matched.", trueUpDraftId: null },
  ];
  const eliminations: Elimination[] = [
    { id: "el-1", description: "Eliminate IC receivable/payable · Northwind Inc. ↔ India", icMatchId: "ic-1", amount: 120000, status: "proposed", preparedBy: null, approvedBy: null },
    { id: "el-2", description: "Eliminate IC receivable/payable · Northwind Inc. ↔ ME FZ-LLC", icMatchId: "ic-2", amount: 84220, status: "proposed", preparedBy: null, approvedBy: null },
  ];

  // ---------------------------------------------------------------- audit seed
  const audit: AuditEvent[] = [];

  const state: State = {
    schema: 3,
    session: null,
    tenant: { id: "tn-northwind", name: "Northwind Holdings", reportingCurrency: "USD" },
    users,
    entities,
    sources,
    stdAccounts,
    accounts,
    varianceMeta,
    glLines,
    periods,
    tasks,
    comments,
    aiOutputs,
    contextNotes,
    thresholds,
    approvalPolicies,
    drafts,
    draftSeq: seq,
    syncRuns,
    audit,
    accruals,
    contracts,
    autoApply,
    consolidation: { status: "in_progress", translationRun: false, reviewed: false, rates, matches, eliminations },
  };
  return state;
}

// ------------------------------------------------------------------ persistence
const KEY = "cch-demo-state";
let state: State | null = null;

export function db(): State {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as State;
      if (parsed.schema === 3) {
        state = parsed;
        return state;
      }
    }
  } catch {
    /* storage unavailable or corrupt: fall back to seed */
  }
  state = seed();
  return state;
}

export function commit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db()));
  } catch {
    /* storage full or blocked: keep in memory only */
  }
}

export function resetDb(keepSession = true) {
  const session = state?.session ?? null;
  state = seed();
  if (keepSession) state.session = session;
  commit();
}

/** For tests. */
export function setDb(s: State) {
  state = s;
}
