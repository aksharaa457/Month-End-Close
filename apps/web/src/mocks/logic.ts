/**
 * Server-side rules for the mock API. These mirror what the FastAPI service
 * layer + database constraints enforce (ARCHITECTURE §5.3, DATABASE §6), so the
 * UI is exercised against the same refusals the real backend will return.
 */
import type {
  AccountClass,
  AiOutput,
  AuditEvent,
  CloseStatus,
  Contract,
  EntityCloseSummary,
  Forecast,
  JeDraft,
  LockGate,
  Me,
  Permission,
  PolicyCheck,
  Problem,
  Role,
  Task,
  Threshold,
  User,
  Variance,
} from "@/shared/api/types";
import { DEMO, db, newId, type AccountRow, type DraftRow, type TaskRow } from "./db";

// ------------------------------------------------------------------ errors
export class HttpProblem extends Error {
  constructor(public problem: Problem) {
    super(problem.detail ?? problem.title);
  }
}
export const fail = (status: number, title: string, detail?: string, code?: string): never => {
  throw new HttpProblem({ type: `https://errors.cch.example/${code ?? status}`, title, status, detail, code, requestId: newId("req") });
};

// ------------------------------------------------------------------ permissions
const ROLE_PERMS: Record<Role, Permission[]> = {
  preparer: ["view", "task.edit", "context.propose", "je.prepare", "recognition.decide"],
  reviewer: ["view", "task.signoff", "context.propose", "context.approve.account", "recognition.decide"],
  approver: ["view", "je.approve"],
  controller: [
    "view", "task.edit", "task.signoff", "context.propose", "context.approve.account", "context.approve.broad",
    "je.prepare", "je.approve", "period.lock", "period.reopen.approve", "thresholds.manage", "audit.view",
    "recognition.decide", "recognition.policy", "consolidation.manage",
  ],
  admin: ["view", "setup.manage", "thresholds.manage"],
  auditor: ["view", "audit.view"],
};

export function permissionsFor(user: User): Record<string, Permission[]> {
  const out: Record<string, Set<Permission>> = {};
  for (const m of user.memberships) {
    const key = m.entityId ?? "*";
    out[key] ??= new Set();
    ROLE_PERMS[m.role].forEach((p) => out[key].add(p));
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

export function can(user: User, perm: Permission, entityId?: string | null) {
  const perms = permissionsFor(user);
  if (perms["*"]?.includes(perm)) return true;
  if (entityId && perms[entityId]?.includes(perm)) return true;
  if (!entityId) return Object.values(perms).some((ps) => ps.includes(perm));
  return false;
}

export function requirePerm(user: User, perm: Permission, entityId?: string | null) {
  if (!can(user, perm, entityId)) fail(403, "Not allowed", `Your role doesn't include "${perm}"${entityId ? ` for this entity` : ""}.`, "forbidden");
}

export function currentUser(): User {
  const s = db().session;
  if (!s) fail(401, "Not signed in", "Your session has ended. Sign in again.", "unauthenticated");
  const u = db().users.find((x) => x.id === s!.userId);
  if (!u || u.status !== "active") fail(401, "Not signed in", "This account is no longer active.", "unauthenticated");
  return u!;
}

export function me(): Me {
  const user = currentUser();
  return { user, tenant: db().tenant, permissions: permissionsFor(user), authTime: db().session!.authTime };
}

export const userName = (id: string | null | undefined) => (id ? db().users.find((u) => u.id === id)?.name ?? "Unknown" : "System");

// ------------------------------------------------------------------ audit (hash-chained)
function fnv(s: string) {
  let h1 = 0x811c9dc5,
    h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822519);
  }
  return ((h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0")).repeat(2);
}

export function audit(
  action: string,
  subjectType: string,
  subjectId: string,
  summary: string,
  opts: { entityId?: string | null; actorType?: AuditEvent["actorType"]; actorId?: string | null } = {},
) {
  const s = db();
  const prev = s.audit[s.audit.length - 1];
  const actorId = opts.actorId === undefined ? s.session?.userId ?? null : opts.actorId;
  const ev: Omit<AuditEvent, "hash"> = {
    id: (prev?.id ?? 0) + 1,
    occurredAt: new Date().toISOString(),
    actorType: opts.actorType ?? (actorId ? "user" : "system"),
    actorId,
    action,
    subjectType,
    subjectId,
    entityId: opts.entityId ?? null,
    summary,
    requestId: newId("req"),
    prevHash: prev?.hash ?? null,
  };
  s.audit.push({ ...ev, hash: fnv((ev.prevHash ?? "") + JSON.stringify(ev)) });
}

// ------------------------------------------------------------------ periods & lock
export function periodOf(entityId: string) {
  const p = db().periods.find((x) => x.entityId === entityId && x.period === DEMO.period);
  if (!p) fail(404, "Period not found");
  return p!;
}

export function assertOpen(entityId: string) {
  if (periodOf(entityId).status === "locked")
    fail(409, "Period is locked", "Aug 2026 is locked for this entity. Request a reopen first.", "period_locked");
}

// ------------------------------------------------------------------ tasks
export function toTask(t: TaskRow): Task {
  const s = db();
  return {
    ...t,
    aiVerification: t.aiVerificationId ? s.aiOutputs.find((o) => o.id === t.aiVerificationId) ?? null : null,
    overdue: t.status !== "completed" && t.dueDay < DEMO.closeDay,
  };
}

// ------------------------------------------------------------------ variances
export function thresholdFor(entityId: string, cls?: AccountClass): Threshold {
  const all = db().thresholds.filter((t) => t.entityId === entityId);
  const specific = cls ? all.filter((t) => t.accountClass === cls).sort((a, b) => b.version - a.version)[0] : undefined;
  return specific ?? all.filter((t) => t.accountClass === null).sort((a, b) => b.version - a.version)[0];
}

function sumTree(accounts: AccountRow[]) {
  const children = new Map<string, AccountRow[]>();
  for (const a of accounts) if (a.parentId) (children.get(a.parentId) ?? children.set(a.parentId, []).get(a.parentId)!).push(a);
  const memo = new Map<string, { prior: number; current: number }>();
  const walk = (a: AccountRow): { prior: number; current: number } => {
    if (memo.has(a.id)) return memo.get(a.id)!;
    let r = { prior: a.prior, current: a.current };
    if (a.isGroup) {
      r = { prior: 0, current: 0 };
      for (const c of children.get(a.id) ?? []) {
        const v = walk(c);
        r.prior += v.prior;
        r.current += v.current;
      }
    }
    r = { prior: Math.round(r.prior * 100) / 100, current: Math.round(r.current * 100) / 100 };
    memo.set(a.id, r);
    return r;
  };
  return { walk, children };
}

export function isFlagged(prior: number, current: number, t: Threshold) {
  const delta = current - prior;
  const pctTrip = prior !== 0 && Math.abs(delta / prior) * 100 > t.pct;
  return Math.abs(delta) > t.absAmount || pctTrip;
}

export function variancesFor(entityId: string): Variance[] {
  const s = db();
  const entity = s.entities.find((e) => e.id === entityId)!;
  const accounts = s.accounts.filter((a) => a.entityId === entityId);
  const { walk, children } = sumTree(accounts);
  const out: Variance[] = [];
  const visit = (a: AccountRow, depth: number) => {
    const { prior, current } = walk(a);
    const delta = Math.round((current - prior) * 100) / 100;
    const t = thresholdFor(entityId, a.accountClass);
    // Top-level statement totals (Income, Assets…) are summaries, not reviewable lines.
    const flagged = !(a.isGroup && !a.parentId) && isFlagged(prior, current, t);
    const m = s.varianceMeta[a.id];
    const explanation = m?.explanationId ? s.aiOutputs.find((o) => o.id === m.explanationId) ?? null : null;
    let status: Variance["status"] = "not_flagged";
    if (flagged) {
      if (m?.status === "signed_off" || m?.status === "exception") status = m.status;
      else if (m?.status === "needs_manual" || (explanation && explanation.outcome !== "ok")) status = "needs_manual";
      else if (m?.status === "explained") status = "explained";
      else status = explanation ? "open" : "needs_manual";
    }
    const kids = children.get(a.id) ?? [];
    out.push({
      id: a.id,
      entityId,
      accountId: a.id,
      accountCode: a.code,
      accountName: a.name,
      accountClass: a.accountClass,
      parentAccountId: a.parentId,
      isGroup: a.isGroup,
      depth,
      currency: entity.functionalCurrency,
      prior,
      current,
      delta,
      deltaPct: prior === 0 ? null : Math.round((delta / Math.abs(prior)) * 1000) / 10,
      isFlagged: flagged,
      thresholdVersion: t.version,
      status,
      explanation,
      attributions: a.isGroup
        ? kids
            .map((c) => {
              const v = walk(c);
              return { accountId: c.id, accountCode: c.code, accountName: c.name, amount: Math.round((v.current - v.prior) * 100) / 100 };
            })
            .filter((x) => x.amount !== 0)
            .map((x) => ({ ...x, sharePct: delta === 0 ? 0 : Math.round((x.amount / delta) * 1000) / 10 }))
            .sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount))
        : [],
      signedOffBy: m?.signedOffBy ?? null,
      exceptionReason: m?.exceptionReason ?? null,
      changedAfterSignoff: m?.changedAfterSignoff ?? false,
      draftIds: s.drafts.filter((d) => d.sourceType === "variance" && d.sourceId === a.id && d.status !== "withdrawn").map((d) => d.id),
      version: m?.version ?? 1,
    });
    kids
      .slice()
      .sort((x, y) => x.code.localeCompare(y.code))
      .forEach((c) => visit(c, depth + 1));
  };
  accounts
    .filter((a) => !a.parentId)
    .sort((x, y) => (x.accountClass === "revenue" ? -1 : y.accountClass === "revenue" ? 1 : x.code.localeCompare(y.code)))
    .forEach((a) => visit(a, 0));
  return out;
}

// ------------------------------------------------------------------ close status
export function lockGates(entityId: string): LockGate[] {
  const s = db();
  const tasks = s.tasks.filter((t) => t.entityId === entityId);
  const open = tasks.filter((t) => t.status !== "completed").length;
  const vars = variancesFor(entityId).filter((v) => v.isFlagged);
  const unsigned = vars.filter((v) => v.status !== "signed_off" && v.status !== "exception").length;
  const unmapped = s.accounts.filter((a) => a.entityId === entityId && !a.isGroup && !a.stdAccountId && (a.current !== 0 || a.prior !== 0)).length;
  return [
    { key: "tasks", label: "All checklist tasks completed", met: open === 0, detail: open === 0 ? "All tasks are complete." : `${open} of ${tasks.length} tasks are not complete.`, link: `/e/${entityId}/checklist` },
    { key: "variances", label: "Every flagged variance signed off or excepted", met: unsigned === 0, detail: unsigned === 0 ? "All flagged lines are signed off." : `${unsigned} of ${vars.length} flagged lines still need sign-off.`, link: `/e/${entityId}/flux` },
    { key: "mappings", label: "No unmapped accounts with a balance", met: unmapped === 0, detail: unmapped === 0 ? "Every account with a balance is mapped." : `${unmapped} account(s) with a balance are unmapped.`, link: `/setup?tab=mapping&entity=${entityId}` },
  ];
}

export function projection(entityId: string) {
  const tasks = db().tasks.filter((t) => t.entityId === entityId);
  const done = tasks.filter((t) => t.status === "completed").length;
  const remaining = tasks.length - done;
  const velocity = Math.max(done / Math.max(DEMO.closeDay, 1), 1) * 2;
  return Math.round((DEMO.closeDay + remaining / velocity) * 10) / 10;
}

export function entitySummary(entityId: string): EntityCloseSummary {
  const s = db();
  const e = s.entities.find((x) => x.id === entityId)!;
  const p = periodOf(entityId);
  const tasks = s.tasks.filter((t) => t.entityId === entityId);
  const done = tasks.filter((t) => t.status === "completed").length;
  const overdue = tasks.filter((t) => t.status !== "completed" && t.dueDay < DEMO.closeDay).length;
  const projected = e.status === "active" ? (p.status === "locked" ? DEMO.closeDay : projection(entityId)) : null;
  let status: CloseStatus = "setup_required";
  if (e.status === "active") {
    status = projected! <= p.targetCloseDay + 0.5 ? "on_track" : projected! <= p.targetCloseDay + 1.5 ? "needs_review" : "at_risk";
  }
  return {
    entityId,
    entityName: e.name,
    region: e.region,
    erpType: e.erpType,
    period: DEMO.period,
    status,
    periodStatus: p.status,
    tasksTotal: tasks.length,
    tasksDone: e.status === "active" ? done : 0,
    tasksOverdue: e.status === "active" ? overdue : 0,
    pctComplete: e.status === "active" ? Math.round((done / tasks.length) * 1000) / 10 : 0,
    targetCloseDay: p.targetCloseDay,
    projectedCloseDay: projected,
    lastSyncAt: e.connection.lastSyncAt,
  };
}

export function forecastFor(entityIds: string[]): Forecast {
  const s = db();
  const active = entityIds.filter((id) => s.entities.find((e) => e.id === id)?.status === "active");
  const sums = active.map(entitySummary);
  const worst = sums.sort((a, b) => (b.projectedCloseDay ?? 0) - (a.projectedCloseDay ?? 0))[0];
  const plan = worst?.targetCloseDay ?? 6;
  const projected = worst?.projectedCloseDay ?? plan;
  const overdue = s.tasks.filter((t) => active.includes(t.entityId) && t.status !== "completed" && t.dueDay < DEMO.closeDay);
  const unsigned = active.flatMap((id) => variancesFor(id).filter((v) => v.isFlagged && v.status !== "signed_off" && v.status !== "exception"));
  active.forEach((id) => evaluateContracts(id));
  const gating = s.contracts.filter((c) => active.includes(c.entityId) && c.column === "needs_review" && !c.decision);
  const drags: Forecast["drags"] = [];
  if (worst) drags.push({ label: `${worst.entityName} is the critical path`, detail: `Projected ${fmtDay(projected)} against a plan of ${fmtDay(plan)}.`, link: `/e/${worst.entityId}/overview` });
  if (overdue.length) drags.push({ label: `${overdue.length} overdue tasks`, detail: overdue.slice(0, 3).map((t) => `${t.title} (${s.entities.find((e) => e.id === t.entityId)?.name.replace("Northwind ", "")})`).join(", "), link: `/e/${overdue[0].entityId}/checklist?filter=overdue` });
  if (unsigned.length) drags.push({ label: `${unsigned.length} flagged variances not signed off`, detail: "Flux & variance is behind pace.", link: `/e/${unsigned[0].entityId}/flux` });
  if (gating.length) drags.push({ label: `${gating.length} recognition decisions open`, detail: "Recognition run is held until the gating queue is decided.", link: `/e/${gating[0].entityId}/recognition` });
  return { projectedCloseDay: projected, planCloseDay: plan, varianceDays: Math.round((projected - plan) * 10) / 10, drags };
}

const fmtDay = (n: number) => `D+${Number.isInteger(n) ? n : n.toFixed(1)}`;

// ------------------------------------------------------------------ drafts
export function toDraft(d: DraftRow): JeDraft {
  const s = db();
  const totalDebit = Math.round(d.lines.reduce((x, l) => x + l.debit, 0) * 100) / 100;
  const totalCredit = Math.round(d.lines.reduce((x, l) => x + l.credit, 0) * 100) / 100;
  return {
    ...d,
    aiOutput: d.aiOutputId ? s.aiOutputs.find((o) => o.id === d.aiOutputId) ?? null : null,
    totalDebit,
    totalCredit,
  };
}

export function draftOr404(id: string) {
  const d = db().drafts.find((x) => x.id === id);
  if (!d) fail(404, "Entry not found");
  return d!;
}

/** JE-4 / DATABASE trigger check_approval_sod. */
export function assertCanApprove(user: User, d: DraftRow, version: number) {
  requirePerm(user, "je.approve", d.entityId);
  if (d.status !== "submitted") fail(409, "Not awaiting approval", `This entry is ${d.status.replace("_", " ")}.`, "invalid_state");
  if (version !== d.version) fail(409, "Entry changed since you reviewed it", `You reviewed v${version}; the entry is now v${d.version}. Reload and review again.`, "stale_version");
  if (d.preparerId === user.id) fail(403, "Segregation of duties", "You prepared or last edited this entry, so you can't approve it.", "sod_preparer");
  const level1 = d.approvals.find((a) => a.level === 1 && a.decision === "approved" && a.draftVersion === d.version);
  if (level1 && level1.approverId === user.id) fail(403, "Segregation of duties", "The second approval must come from a different person.", "sod_second_approver");
}

// ------------------------------------------------------------------ recognition policy (§10.1)
export function evaluateContracts(entityId: string) {
  const s = db();
  const policy = s.autoApply.find((p) => p.entityId === entityId);
  if (!policy) return;
  const monthlyRevenue = 1560000;
  let running = 0;
  for (const c of s.contracts.filter((x) => x.entityId === entityId)) {
    const checks: PolicyCheck[] = [
      { key: "amount", label: `≤ ${usd(policy.maxPerItem)} and ≤ ${policy.maxPctOfRevenue}% of monthly revenue`, passed: c.monthly <= policy.maxPerItem && c.monthly <= (monthlyRevenue * policy.maxPctOfRevenue) / 100, detail: `${usd(c.monthly)} this period` },
      { key: "confidence", label: `AI confidence ≥ ${policy.minConfidence.toFixed(2)}`, passed: c.confidence >= policy.minConfidence, detail: c.confidence.toFixed(2) },
      { key: "evidence", label: "Trigger evidence in source of record", passed: c.evidenceFound, detail: c.evidenceFound ? "Found" : "Not found" },
      { key: "shape", label: "Standard schedule, no modification this period", passed: !c.modifiedThisPeriod, detail: c.modifiedThisPeriod ? "Modified this period" : "Standard" },
      { key: "history", label: `No override in last ${policy.historyPeriods} periods`, passed: true, detail: "None" },
    ];
    const allPass = checks.every((x) => x.passed);
    const capOk = running + c.monthly <= policy.aggregateCap;
    checks.push({ key: "cap", label: `Aggregate cap ${usd(policy.aggregateCap)}`, passed: !allPass || capOk, detail: `${usd(running)} used` });
    c.policyChecks = checks;
    if (!c.decision || c.decision.action === "pulled_back") {
      if (c.decision?.action === "pulled_back") c.column = "needs_review";
      else c.column = policy.enabled && allPass && capOk ? "auto_applied" : "needs_review";
    }
    if (c.column === "auto_applied") running += c.monthly;
  }
}

export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function contractOr404(id: string): Contract {
  const c = db().contracts.find((x) => x.id === id);
  if (!c) fail(404, "Contract not found");
  return c!;
}

// ------------------------------------------------------------------ AI helper
export function newAi(partial: Partial<AiOutput> & Pick<AiOutput, "kind" | "text">): AiOutput {
  const o: AiOutput = {
    id: newId("ai"),
    outcome: "ok",
    modelId: DEMO.modelId,
    promptVersion: `${partial.kind}@1`,
    citations: [],
    confidence: 0.9,
    inferenceRegion: DEMO.region,
    createdAt: new Date().toISOString(),
    dataAsOf: new Date().toISOString(),
    contextNoteIds: [],
    ...partial,
  };
  db().aiOutputs.push(o);
  return o;
}
