import { http, HttpResponse, delay } from "msw";
import type { Job, Notification, TraceNode } from "@/shared/api/types";
import { DEMO, commit, db, newId, resetDb } from "../db";
import { HttpProblem, audit, can, currentUser, fail, me, periodOf, requirePerm, toDraft, userName, variancesFor } from "../logic";

export const API = "/api/v1";

// ------------------------------------------------------------------ route wrapper
export interface Ctx {
  request: Request;
  params: Record<string, string>;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  url: URL;
}

const idempotency = new Map<string, { status: number; body: unknown }>();
let csrf: string | null = null;

export function setCsrf(token: string | null) {
  csrf = token;
  try {
    document.cookie = token ? `cch_csrf=${token}; path=/; SameSite=Lax` : "cch_csrf=; path=/; max-age=0";
  } catch {
    /* no document in tests */
  }
}

export function route(fn: (c: Ctx) => unknown, opts: { public?: boolean; latency?: number } = {}) {
  return async ({ request, params }: { request: Request; params: Record<string, unknown> }) => {
    await delay(opts.latency ?? 120 + Math.random() * 180);
    const url = new URL(request.url);
    const isWrite = request.method !== "GET";
    let body: unknown = undefined;
    if (isWrite) {
      try {
        body = await request.clone().json();
      } catch {
        body = {};
      }
    }
    const key = request.headers.get("Idempotency-Key");
    if (isWrite && key && idempotency.has(key)) {
      const prev = idempotency.get(key)!;
      return HttpResponse.json(prev.body as never, { status: prev.status, headers: { "Idempotent-Replay": "true" } });
    }
    try {
      if (isWrite && !opts.public) {
        currentUser();
        if (csrf && request.headers.get("X-CSRF-Token") !== csrf) fail(403, "CSRF check failed", "Reload the page and try again.", "csrf");
      }
      const result = await fn({ request, params: params as Record<string, string>, body, url });
      if (result instanceof Response) return result;
      if (isWrite) {
        commit();
        if (key) idempotency.set(key, { status: 200, body: result ?? {} });
      }
      return HttpResponse.json((result ?? {}) as never);
    } catch (e) {
      if (e instanceof HttpProblem) {
        return HttpResponse.json(e.problem as never, { status: e.problem.status, headers: { "Content-Type": "application/problem+json" } });
      }
      console.error("[mock api]", e);
      return HttpResponse.json({ type: "about:blank", title: "Server error", status: 500, detail: String(e) } as never, { status: 500 });
    }
  };
}

// ------------------------------------------------------------------ jobs
interface JobRec {
  job: Job;
  start: number;
  duration: number;
  steps: string[];
  effect?: () => Record<string, unknown> | void;
  applied: boolean;
}
const jobs = new Map<string, JobRec>();

export function startJob(kind: Job["kind"], duration: number, steps: string[], effect?: JobRec["effect"]): Job {
  const job: Job = { id: newId("job"), kind, status: "queued", progress: 0, message: steps[0] ?? "Queued", createdAt: new Date().toISOString() };
  jobs.set(job.id, { job, start: Date.now(), duration, steps, effect, applied: false });
  return job;
}

function readJob(id: string): Job {
  const rec = jobs.get(id);
  if (!rec) fail(404, "Job not found", "Jobs are kept in memory in the demo; it may have been lost on reload.");
  const r = rec!;
  const elapsed = Date.now() - r.start;
  const progress = Math.min(100, Math.round((elapsed / r.duration) * 100));
  if (progress >= 100 && !r.applied) {
    r.applied = true;
    try {
      const result = r.effect?.() ?? {};
      r.job = { ...r.job, status: "succeeded", progress: 100, message: "Done", result };
    } catch (e) {
      r.job = { ...r.job, status: "failed", progress: 100, message: e instanceof HttpProblem ? e.problem.detail ?? e.problem.title : String(e) };
    }
    commit();
  } else if (!r.applied) {
    r.job = { ...r.job, status: "running", progress, message: r.steps[Math.min(r.steps.length - 1, Math.floor((progress / 100) * r.steps.length))] };
  }
  return r.job;
}

// ------------------------------------------------------------------ handlers
export const coreHandlers = [
  // ---- auth (ARCHITECTURE §6.1, simulated WorkOS + customer IdP)
  http.get(`${API}/auth/login`, route(() => ({ redirectUrl: `/sso/idp?state=${newId("st")}` }), { public: true })),
  http.get(
    `${API}/auth/idp-directory`,
    route(() => db().users.map((u) => ({ email: u.email, name: u.name, title: u.title, status: u.status })), { public: true }),
  ),
  http.post(
    `${API}/auth/callback`,
    route(
      ({ body }) => {
        const s = db();
        const u = s.users.find((x) => x.email.toLowerCase() === String(body.email ?? "").toLowerCase());
        if (!u) fail(403, "Not provisioned", "Your organization hasn't given you access to Continuous Close Hub. Ask your admin to invite you.", "not_provisioned");
        if (u!.status === "deactivated") fail(403, "Account deactivated", "This account was deactivated by your identity provider.", "deactivated");
        if (u!.status === "invited") {
          u!.status = "active";
          audit("user.activated", "user", u!.id, `${u!.name} accepted their invitation on first sign-in`, { actorId: u!.id });
        }
        s.session = { userId: u!.id, authTime: new Date().toISOString() };
        setCsrf(newId("csrf"));
        audit("session.created", "user", u!.id, `${u!.name} signed in via SSO`, { actorId: u!.id });
        commit();
        return me();
      },
      { public: true },
    ),
  ),
  http.post(
    `${API}/auth/logout`,
    route(
      () => {
        const s = db();
        if (s.session) audit("session.revoked", "user", s.session.userId, `${userName(s.session.userId)} signed out`);
        s.session = null;
        setCsrf(null);
        commit();
        return {};
      },
      { public: true },
    ),
  ),
  http.get(`${API}/me`, route(() => me(), { latency: 60 })),
  http.post(
    `${API}/demo/reset`,
    route(
      () => {
        resetDb(true);
        audit("demo.reset", "tenant", db().tenant.id, "Demo data reset to the seed state");
        return {};
      },
    ),
  ),

  // ---- jobs
  http.get(`${API}/jobs/:id`, route(({ params }) => readJob(params.id), { latency: 40 })),

  // ---- notifications (CL-6)
  http.get(
    `${API}/notifications`,
    route(() => {
      const user = currentUser();
      const s = db();
      const out: Notification[] = [];
      for (const t of s.tasks) {
        const active = s.entities.find((e) => e.id === t.entityId)?.status === "active";
        if (!active) continue;
        if (t.ownerId === user.id && t.status !== "completed" && t.dueDay < DEMO.closeDay)
          out.push({ id: `n-${t.id}`, kind: "overdue_task", text: `Overdue: ${t.title} (${s.entities.find((e) => e.id === t.entityId)?.name})`, link: `/e/${t.entityId}/checklist?task=${t.id}`, createdAt: new Date().toISOString() });
        if (t.reviewerId === user.id && t.status === "submitted")
          out.push({ id: `n-s-${t.id}`, kind: "signoff_needed", text: `Sign-off needed: ${t.title}`, link: `/e/${t.entityId}/checklist?task=${t.id}`, createdAt: new Date().toISOString() });
      }
      for (const d of s.drafts)
        if (d.status === "submitted" && d.preparerId !== user.id && can(user, "je.approve", d.entityId))
          out.push({ id: `n-${d.id}`, kind: "approval_needed", text: `Approval needed: ${d.number} ${d.description.slice(0, 40)}`, link: `/e/${d.entityId}/journals?draft=${d.id}`, createdAt: d.createdAt });
      for (const n of s.contextNotes)
        if (n.status === "pending" && n.proposedBy !== user.id && can(user, "context.approve.account", n.entityId))
          out.push({ id: `n-${n.id}`, kind: "context_review", text: `AI context awaiting approval: "${n.text.slice(0, 40)}…"`, link: "/context", createdAt: n.proposedAt });
      for (const e of s.entities)
        if (e.connection.lastError) out.push({ id: `n-sync-${e.id}`, kind: "sync_failed", text: `Sync problem: ${e.name}`, link: "/setup?tab=connections", createdAt: new Date().toISOString() });
      return out.slice(0, 30);
    }),
  ),

  // ---- entities, sources, std accounts
  http.get(`${API}/entities`, route(() => db().entities)),
  http.get(`${API}/sources`, route(() => db().sources)),
  http.get(`${API}/standard-accounts`, route(() => db().stdAccounts)),
  http.get(
    `${API}/entities/:id/sync-runs`,
    route(({ params }) => db().syncRuns.filter((r) => r.entityId === params.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt))),
  ),
  http.post(
    `${API}/entities/:id/connections`,
    route(({ params, body }) => {
      const user = currentUser();
      requirePerm(user, "setup.manage");
      const e = db().entities.find((x) => x.id === params.id);
      if (!e) fail(404, "Entity not found");
      if (!body.accountId || !body.secret) fail(422, "Missing credentials", "Enter the account ID and the integration token.");
      e!.erpType = body.erpType === "sap" ? "sap" : "netsuite";
      e!.connection = { status: "connected", lastSyncAt: null, lastError: null, secretRef: `arn:aws:secretsmanager:…:secret:cch/${e!.id}/erp-••••` };
      audit("connection.created", "entity", e!.id, `${e!.erpType === "sap" ? "SAP" : "NetSuite"} connected for ${e!.name}. Credentials stored in Secrets Manager.`, { entityId: e!.id });
      return e;
    }),
  ),
  http.post(
    `${API}/entities/:id/sync`,
    route(({ params, body }) => {
      const user = currentUser();
      if (!can(user, "setup.manage") && !can(user, "period.lock", params.id)) fail(403, "Not allowed", "Only admins and controllers can trigger a sync.");
      const e = db().entities.find((x) => x.id === params.id);
      if (!e) fail(404, "Entity not found");
      if (e!.connection.status !== "connected") fail(409, "Not connected", "Connect the ledger first.");
      const backfill = body?.backfill === true;
      const steps = backfill
        ? ["Reading chart of accounts", "Backfilling 13 months of balances", "Loading journal lines", "Normalising to the shared ledger model", "Recomputing variances"]
        : ["Fetching changes since last sync", "Normalising to the shared ledger model", "Recomputing variances", "Queuing AI explanations for changed lines"];
      return startJob(backfill ? "backfill" : "sync", backfill ? 6000 : 3500, steps, () => {
        const s = db();
        const ent = s.entities.find((x) => x.id === params.id)!;
        ent.connection.lastSyncAt = new Date().toISOString();
        ent.connection.lastError = null;
        if (backfill) ent.status = "active";
        const run = { id: newId("sync"), entityId: ent.id, trigger: backfill ? ("backfill" as const) : ("manual" as const), status: "succeeded" as const, startedAt: new Date(Date.now() - 4000).toISOString(), finishedAt: new Date().toISOString(), stats: { accounts: s.accounts.filter((a) => a.entityId === ent.id).length, lines: backfill ? 18450 : 214 } };
        s.syncRuns.push(run);
        audit(backfill ? "sync.backfill_completed" : "sync.completed", "entity", ent.id, `${backfill ? "Backfill" : "Sync"} completed for ${ent.name}`, { entityId: ent.id, actorType: "system", actorId: null });
        return { syncRunId: run.id };
      });
    }),
  ),

  // ---- account mapping (US-2)
  http.get(
    `${API}/entities/:id/account-mappings`,
    route(({ params }) =>
      db()
        .accounts.filter((a) => a.entityId === params.id && !a.isGroup)
        .map((a) => ({ accountId: a.id, entityId: a.entityId, erpCode: a.code, name: a.name, accountClass: a.accountClass, stdAccountId: a.stdAccountId, balance: a.current }))
        .sort((x, y) => (x.stdAccountId ? 1 : 0) - (y.stdAccountId ? 1 : 0) || x.erpCode.localeCompare(y.erpCode)),
    ),
  ),
  http.put(
    `${API}/entities/:id/account-mappings`,
    route(({ params, body }) => {
      const user = currentUser();
      requirePerm(user, "setup.manage", params.id);
      const s = db();
      const a = s.accounts.find((x) => x.id === body.accountId && x.entityId === params.id);
      if (!a) fail(404, "Account not found");
      if (body.stdAccountId && !s.stdAccounts.some((x) => x.id === body.stdAccountId)) fail(422, "Unknown standard account");
      a!.stdAccountId = body.stdAccountId ?? null;
      audit("account.mapped", "account", a!.id, `${a!.code} ${a!.name} mapped to ${s.stdAccounts.find((x) => x.id === body.stdAccountId)?.code ?? "nothing"}`, { entityId: params.id });
      return { ok: true };
    }),
  ),

  // ---- thresholds (versioned; never overwritten)
  http.get(`${API}/entities/:id/thresholds`, route(({ params }) => db().thresholds.filter((t) => t.entityId === params.id).sort((a, b) => b.version - a.version))),
  http.post(
    `${API}/entities/:id/thresholds`,
    route(({ params, body }) => {
      const user = currentUser();
      requirePerm(user, "thresholds.manage", params.id);
      const abs = Number(body.absAmount);
      const pctV = Number(body.pct);
      if (!(abs >= 0) || !(pctV >= 0) || pctV > 100) fail(422, "Invalid threshold", "Amount must be ≥ 0 and percentage between 0 and 100.");
      const s = db();
      const versions = s.thresholds.filter((t) => t.entityId === params.id && t.accountClass === (body.accountClass ?? null));
      const t = { id: newId("thr"), entityId: params.id, accountClass: body.accountClass ?? null, absAmount: abs, pct: pctV, version: (Math.max(0, ...versions.map((v) => v.version)) || 0) + 1, effectiveFrom: DEMO.period, createdBy: user.id, createdAt: new Date().toISOString() };
      s.thresholds.push(t);
      audit("threshold.versioned", "threshold", t.id, `Materiality threshold v${t.version}: ${abs.toLocaleString()} / ${pctV}% ${t.accountClass ? `for ${t.accountClass}` : "(default)"}`, { entityId: params.id });
      return t;
    }),
  ),

  // ---- approval policy (JE-4)
  http.get(`${API}/entities/:id/approval-policies`, route(({ params }) => db().approvalPolicies.filter((p) => p.entityId === params.id).sort((a, b) => b.version - a.version))),
  http.post(
    `${API}/entities/:id/approval-policies`,
    route(({ params, body }) => {
      const user = currentUser();
      requirePerm(user, "thresholds.manage", params.id);
      const amt = Number(body.secondApprovalAbove);
      if (!(amt >= 0)) fail(422, "Invalid amount");
      const s = db();
      const prev = s.approvalPolicies.filter((p) => p.entityId === params.id).sort((a, b) => b.version - a.version)[0];
      const p = { ...prev, id: newId("ap"), secondApprovalAbove: amt, version: prev.version + 1, effectiveFrom: DEMO.period };
      s.approvalPolicies.push(p);
      audit("approval_policy.versioned", "approval_policy", p.id, `Second approval required above ${amt.toLocaleString()} ${p.currency} (v${p.version})`, { entityId: params.id });
      return p;
    }),
  ),

  // ---- users & roles
  http.get(`${API}/users`, route(() => db().users)),
  http.post(
    `${API}/users`,
    route(({ body }) => {
      const user = currentUser();
      requirePerm(user, "setup.manage");
      const s = db();
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(422, "Invalid email");
      if (s.users.some((u) => u.email.toLowerCase() === email)) fail(409, "Already invited", "A user with this email already exists.");
      const u = { id: newId("u"), name: String(body.name).trim(), email, title: String(body.title ?? ""), status: "invited" as const, memberships: [{ id: newId("m"), entityId: body.entityId ?? null, role: body.role }] };
      s.users.push(u);
      audit("user.invited", "user", u.id, `${u.name} invited as ${body.role}`);
      return u;
    }),
  ),
  http.put(
    `${API}/users/:id/memberships`,
    route(({ params, body }) => {
      const user = currentUser();
      requirePerm(user, "setup.manage");
      const u = db().users.find((x) => x.id === params.id);
      if (!u) fail(404, "User not found");
      if (params.id === user.id) fail(403, "Not allowed", "You can't change your own roles.", "sod_self_roles");
      u!.memberships = (body.memberships ?? []).map((m: { entityId: string | null; role: string }) => ({ id: newId("m"), entityId: m.entityId ?? null, role: m.role }));
      audit("user.roles_changed", "user", u!.id, `Roles for ${u!.name}: ${u!.memberships.map((m) => m.role).join(", ") || "none"}`);
      return u;
    }),
  ),
  http.post(
    `${API}/users/:id/deactivate`,
    route(({ params }) => {
      const user = currentUser();
      requirePerm(user, "setup.manage");
      if (params.id === user.id) fail(403, "Not allowed", "You can't deactivate yourself.");
      const u = db().users.find((x) => x.id === params.id);
      if (!u) fail(404, "User not found");
      u!.status = "deactivated";
      audit("user.deactivated", "user", u!.id, `${u!.name} deactivated (SCIM). All sessions revoked.`);
      return u;
    }),
  ),

  // ---- audit (US-22, US-24)
  http.get(
    `${API}/audit/events`,
    route(({ url }) => {
      const user = currentUser();
      requirePerm(user, "audit.view");
      const entityId = url.searchParams.get("entityId");
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const subjectId = url.searchParams.get("subjectId");
      return db()
        .audit.filter((e) => (!entityId || e.entityId === entityId) && (!subjectId || e.subjectId === subjectId) && (!q || `${e.action} ${e.summary}`.toLowerCase().includes(q)))
        .slice()
        .reverse()
        .slice(0, 500);
    }),
  ),
  http.get(
    `${API}/audit/verify`,
    route(() => {
      const ev = db().audit;
      for (let i = 1; i < ev.length; i++) if (ev[i].prevHash !== ev[i - 1].hash) return { ok: false, brokenAt: ev[i].id, count: ev.length };
      return { ok: true, count: ev.length };
    }),
  ),
  http.post(
    `${API}/audit/exports`,
    route(({ body }) => {
      const user = currentUser();
      requirePerm(user, "audit.view");
      const entityId = body.entityId ?? null;
      return startJob("audit_export", 2500, ["Collecting events", "Verifying hash chain", "Writing export file"], () => {
        const events = db().audit.filter((e) => !entityId || e.entityId === entityId);
        audit("audit.exported", "tenant", db().tenant.id, `Audit export of ${events.length} events`, { actorId: user.id });
        return { fileName: `audit-${entityId ?? "all"}-2026-08.json`, count: events.length, data: JSON.stringify(events, null, 2) };
      });
    }),
  ),
  http.get(
    `${API}/trace/je_draft/:id`,
    route(({ params }) => {
      const user = currentUser();
      requirePerm(user, "audit.view");
      const s = db();
      const d = s.drafts.find((x) => x.id === params.id);
      if (!d) fail(404, "Entry not found");
      const draft = toDraft(d!);
      const nodes: TraceNode[] = [];
      for (const p of draft.postingAttempts.slice().reverse())
        nodes.push({ kind: "posting", id: `${d!.id}-p${p.attemptNo}`, title: `Posting attempt ${p.attemptNo}: ${p.status}`, detail: p.erpDocNumber ? `ERP document ${p.erpDocNumber}` : p.error ?? "", at: p.at, actor: "Worker (app_worker)" });
      for (const a of draft.approvals.slice().reverse())
        nodes.push({ kind: "approval", id: a.id, title: `Level ${a.level} ${a.decision}`, detail: `Approved version v${a.draftVersion}${a.batchId ? " in a batch" : ""}${a.comment ? ` · "${a.comment}"` : ""}`, at: a.decidedAt, actor: userName(a.approverId) });
      nodes.push({ kind: "draft", id: d!.id, title: `${draft.number} · ${draft.type}`, detail: `${draft.description}. Debits ${draft.totalDebit.toLocaleString()} = credits ${draft.totalCredit.toLocaleString()}. Prepared by ${userName(draft.preparerId)}.`, at: draft.createdAt, actor: draft.createdByAi ? "AI draft, then " + userName(draft.preparerId) : userName(draft.preparerId) });
      if (draft.aiOutput)
        nodes.push({ kind: "ai_output", id: draft.aiOutput.id, title: `AI output · ${draft.aiOutput.modelId}`, detail: `Prompt ${draft.aiOutput.promptVersion} · confidence ${draft.aiOutput.confidence ?? "n/a"} · region ${draft.aiOutput.inferenceRegion}. "${draft.aiOutput.text}"`, at: draft.aiOutput.createdAt, actor: "AI gateway" });
      if (d!.sourceType === "variance" && d!.sourceId) {
        const v = variancesFor(d!.entityId).find((x) => x.id === d!.sourceId);
        if (v) {
          nodes.push({ kind: "variance", id: v.id, title: `Variance · ${v.accountCode} ${v.accountName}`, detail: `${v.prior.toLocaleString()} → ${v.current.toLocaleString()} (${v.deltaPct ?? "n/a"}%) · flagged by threshold v${v.thresholdVersion}`, at: null, actor: null });
          for (const c of v.explanation?.citations ?? [])
            if (c.recordType === "gl_line") {
              const g = s.glLines.find((x) => x.id === c.recordId);
              nodes.push({ kind: "gl_line", id: c.recordId, title: `GL line ${g?.ref ?? c.recordId}`, detail: g ? `${g.postingDate} · ${g.amount.toLocaleString()} · ${g.memo}` : c.label, at: null, actor: null });
            }
        }
      }
      const run = s.syncRuns.filter((r) => r.entityId === d!.entityId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
      if (run) nodes.push({ kind: "sync_run", id: run.id, title: `Source data · sync ${run.trigger}`, detail: `${run.stats.lines.toLocaleString()} lines synced from ${s.entities.find((e) => e.id === d!.entityId)?.erpType === "sap" ? "SAP" : "NetSuite"}`, at: run.finishedAt, actor: "Worker (app_worker)" });
      return { draft, nodes, period: periodOf(d!.entityId).period };
    }),
  ),
];
