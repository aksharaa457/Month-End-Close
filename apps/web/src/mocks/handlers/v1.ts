import { http, HttpResponse } from "msw";
import type { AccrualsView, Citation, ConsolidatedLine, ConsolidationView, RecognitionView, TranslationRow } from "@/shared/api/types";
import { DEMO, db, newId, type DraftRow } from "../db";
import {
  assertOpen,
  audit,
  can,
  contractOr404,
  currentUser,
  entitySummary,
  evaluateContracts,
  fail,
  forecastFor,
  newAi,
  periodOf,
  requirePerm,
  toDraft,
  usd,
  variancesFor,
} from "../logic";
import { API, route, startJob } from "./core";

function newDraft(entityId: string, partial: Partial<DraftRow> & Pick<DraftRow, "type" | "sourceType" | "description" | "lines">, preparerId: string) {
  const s = db();
  const entity = s.entities.find((e) => e.id === entityId)!;
  const policy = s.approvalPolicies.filter((p) => p.entityId === entityId).sort((a, b) => b.version - a.version)[0];
  s.draftSeq += 1;
  const total = partial.lines.reduce((x, l) => x + l.debit, 0);
  const d: DraftRow = {
    id: `je-${s.draftSeq}`,
    number: `JE-${s.draftSeq}`,
    entityId,
    periodId: `p-${entityId}-2026-08`,
    sourceId: null,
    sourceLabel: null,
    status: "draft",
    createdByAi: true,
    aiOutputId: null,
    preparerId,
    currency: entity.functionalCurrency,
    requiresSecondApproval: total > policy.secondApprovalAbove,
    version: 1,
    approvals: [],
    postingAttempts: [],
    erpDocNumber: null,
    sourceChanged: false,
    createdAt: new Date().toISOString(),
    ...partial,
  };
  s.drafts.push(d);
  return d;
}

function acct(entityId: string, code: string, fallbackClass: "liability" | "expense") {
  const s = db();
  return s.accounts.find((a) => a.entityId === entityId && a.code === code && !a.isGroup) ?? s.accounts.find((a) => a.entityId === entityId && !a.isGroup && a.accountClass === fallbackClass)!;
}

// ------------------------------------------------------------------ copilot (AI-1..AI-5)
function answer(q: string, entityId: string | null): { text: string; citations: Citation[]; outcome: "ok" | "insufficient_data" } {
  const user = currentUser();
  const s = db();
  const text = q.toLowerCase();
  const visible = s.entities.filter((e) => can(user, "view", e.id));
  const eid = entityId && visible.some((e) => e.id === entityId) ? entityId : "e-us";
  if (/behind|plan|late|critical path|forecast/.test(text)) {
    const f = forecastFor(visible.map((e) => e.id));
    const lines = f.drags.map((d) => `• ${d.label}: ${d.detail}`).join("\n");
    return {
      text: `The group close is projected at D+${f.projectedCloseDay} against a plan of D+${f.planCloseDay} (${f.varianceDays >= 0 ? "+" : ""}${f.varianceDays} days). What's driving it:\n${lines}`,
      citations: f.drags.map((d) => ({ recordType: "task" as const, recordId: d.link, label: d.label, link: d.link })),
      outcome: "ok",
    };
  }
  const contract = s.contracts.find((c) => text.includes(c.customer.toLowerCase().split(" ")[0]));
  if (contract || /gating|recognition|asc 606/.test(text)) {
    const c = contract ?? s.contracts.find((x) => x.column === "needs_review" && !x.decision)!;
    return {
      text: `${c.customer} (${c.code}): ARR ${usd(c.arr)}, ${usd(c.monthly)} a month. It's in "${c.column.replace("_", " ")}". Trigger: ${c.trigger}. Evidence: ${c.evidence.join("; ")}. Recommendation: ${c.recommendation.label} — ${c.recommendation.rationale}`,
      citations: [{ recordType: "contract", recordId: c.id, label: `${c.customer} contract`, link: `/e/${c.entityId}/recognition?contract=${c.id}` }],
      outcome: "ok",
    };
  }
  if (/journal|draft|je\b|entries/.test(text)) {
    const ds = s.drafts.filter((d) => d.entityId === eid).map(toDraft);
    const by = (st: string) => ds.filter((d) => d.status === st);
    const total = ds.filter((d) => !["withdrawn", "rejected"].includes(d.status)).reduce((x, d) => x + d.totalDebit, 0);
    return {
      text: `${ds.length} journal entries for ${s.entities.find((e) => e.id === eid)?.name}, totalling ${usd(total)}: ${by("submitted").length} awaiting approval, ${by("draft").length} drafts, ${by("posted").length} posted and ${by("post_failed").length} approved but not posted. Every entry links to the variance and ledger data behind it.`,
      citations: ds.slice(0, 4).map((d) => ({ recordType: "je_draft" as const, recordId: d.id, label: `${d.number} · ${d.sourceLabel ?? d.description}`, link: `/e/${d.entityId}/journals?draft=${d.id}` })),
      outcome: "ok",
    };
  }
  const v = variancesFor(eid).filter((x) => x.isFlagged).find((x) => text.includes(x.accountName.toLowerCase().split(" ")[0]) || text.includes(x.accountCode));
  if (v) {
    return {
      text: `${v.accountCode} ${v.accountName}: ${v.prior.toLocaleString()} → ${v.current.toLocaleString()} (${v.deltaPct ?? "n/a"}%). ${v.explanation?.text ?? "No AI explanation yet."}${v.attributions.length ? ` Largest contributor: ${v.attributions[0].accountName} (${v.attributions[0].sharePct}%).` : ""}`,
      citations: [{ recordType: "variance", recordId: v.id, label: `${v.accountCode} ${v.accountName}`, link: `/e/${v.entityId}/flux?variance=${v.id}` }, ...(v.explanation?.citations ?? [])],
      outcome: "ok",
    };
  }
  if (/overdue|task|checklist/.test(text)) {
    const t = s.tasks.filter((x) => visible.some((e) => e.id === x.entityId) && x.status !== "completed" && x.dueDay < DEMO.closeDay);
    return {
      text: t.length ? `${t.length} overdue tasks: ${t.slice(0, 5).map((x) => `${x.title} (${s.entities.find((e) => e.id === x.entityId)?.name})`).join("; ")}.` : "No tasks are overdue.",
      citations: t.slice(0, 5).map((x) => ({ recordType: "task" as const, recordId: x.id, label: x.title, link: `/e/${x.entityId}/checklist?task=${x.id}` })),
      outcome: "ok",
    };
  }
  return {
    text: "I don't have data in the Enterprise Brain to answer that. I can answer questions about close status, overdue tasks, variances, journal entries and recognition decisions — for example \"Why are we behind plan?\".",
    citations: [],
    outcome: "insufficient_data",
  };
}

// ------------------------------------------------------------------ consolidation
function consolidationView(): ConsolidationView {
  const s = db();
  const c = s.consolidation;
  const active = s.entities.filter((e) => e.status === "active");
  const rate = (ccy: string, kind: "closing" | "average") => (ccy === "USD" ? 1 : c.rates.find((r) => r.ccy === ccy)?.[kind] ?? 1);
  const translation: TranslationRow[] = active.map((e) => {
    const vars = variancesFor(e.id).filter((v) => !v.isGroup);
    const sum = (cls: string) => vars.filter((v) => v.accountClass === cls).reduce((x, v) => x + v.current, 0);
    const assets = sum("asset");
    const liabilities = sum("liability");
    const netIncome = sum("revenue") - sum("expense");
    const equity = assets - liabilities;
    const cl = rate(e.functionalCurrency, "closing");
    const av = rate(e.functionalCurrency, "average");
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const equityUsd = r2((equity - netIncome) * cl * 1.004 + netIncome * av); // opening equity at historical (approximated)
    return { entityId: e.id, entityName: e.name, ccy: e.functionalCurrency, assets: r2(assets), liabilities: r2(liabilities), equity: r2(equity), netIncome: r2(netIncome), assetsUsd: r2(assets * cl), liabilitiesUsd: r2(liabilities * cl), equityUsd, netIncomeUsd: r2(netIncome * av), cta: r2(assets * cl - liabilities * cl - equityUsd) };
  });
  const matches = c.matches.map((m) => {
    const d = m.trueUpDraftId ? s.drafts.find((x) => x.id === m.trueUpDraftId) : null;
    return d && d.status === "posted" ? { ...m, status: "resolved" as const } : m;
  });
  const elimTotal = c.eliminations.filter((e) => e.status !== "proposed").reduce((x, e) => x + e.amount, 0);
  const lineDefs: [string, string, "pl" | "bs", (id: string) => number, number][] = [
    ["REV", "Revenue", "pl", (id) => sumCls(id, "revenue", "average"), -elimTotal * 0.3],
    ["EXP", "Expenses", "pl", (id) => sumCls(id, "expense", "average"), -elimTotal * 0.3],
    ["NI", "Net income", "pl", (id) => sumCls(id, "revenue", "average") - sumCls(id, "expense", "average"), 0],
    ["AST", "Total assets", "bs", (id) => sumCls(id, "asset", "closing"), -elimTotal],
    ["LIA", "Total liabilities", "bs", (id) => sumCls(id, "liability", "closing"), -elimTotal],
    ["EQ", "Total equity", "bs", (id) => sumCls(id, "asset", "closing") - sumCls(id, "liability", "closing"), 0],
  ];
  function sumCls(id: string, cls: string, kind: "closing" | "average") {
    const e = s.entities.find((x) => x.id === id)!;
    return variancesFor(id).filter((v) => !v.isGroup && v.accountClass === cls).reduce((x, v) => x + v.current, 0) * rate(e.functionalCurrency, kind);
  }
  const statements: ConsolidatedLine[] = lineDefs.map(([code, name, statement, f, elim]) => {
    const byEntity = Object.fromEntries(active.map((e) => [e.id, Math.round(f(e.id))]));
    const total = Object.values(byEntity).reduce((x, n) => x + n, 0);
    return { code, name, statement, byEntity, eliminations: Math.round(elim), consolidated: Math.round(total + elim) };
  });
  const icDone = matches.every((m) => m.status === "matched" || m.status === "resolved" || m.status === "pending_counterparty");
  const elimDone = c.eliminations.every((e) => e.status !== "proposed");
  const allLocked = active.every((e) => periodOf(e.id).status === "locked");
  return {
    period: DEMO.period,
    status: c.status,
    tolerance: { absUsd: 500, pct: 1 },
    steps: [
      { key: "ic", label: "Intercompany reconciled", done: icDone, detail: icDone ? "All matched or explained." : `${matches.filter((m) => m.status === "mismatch").length} mismatch(es) need a true-up.` },
      { key: "translation", label: "Currency translation run", done: c.translationRun, detail: c.translationRun ? "Translated at Aug closing / average rates." : "Run translation (ASC 830)." },
      { key: "elims", label: "Eliminations approved", done: elimDone, detail: elimDone ? "All eliminations approved." : `${c.eliminations.filter((e) => e.status === "proposed").length} awaiting approval.` },
      { key: "review", label: "Consolidated review", done: c.reviewed, detail: c.reviewed ? "Reviewed." : "Review consolidated statements." },
      { key: "lock", label: "Sign-off and lock", done: c.status === "locked", detail: allLocked ? (c.status === "locked" ? "Locked." : "Ready to lock.") : `Every entity period must be locked first (${active.filter((e) => periodOf(e.id).status === "locked").length}/${active.length} locked).` },
    ],
    rates: c.rates,
    translation,
    matches,
    eliminations: c.eliminations,
    statements,
    entityIds: active.map((e) => e.id),
  };
}

export const v1Handlers = [
  // ---- accruals (F8)
  http.get(
    `${API}/entities/:id/accruals`,
    route(({ params }): AccrualsView => {
      currentUser();
      const s = db();
      const proposals = s.accruals.filter((a) => a.entityId === params.id);
      const entity = s.entities.find((e) => e.id === params.id)!;
      const scale = entity.functionalCurrency === "INR" ? 80 : entity.functionalCurrency === "AED" ? 3.67 : 1;
      const categories = [
        { category: "Software", actual: 182300, runRate: 240000 },
        { category: "Hosting / Cloud", actual: 41200, runRate: 96400 },
        { category: "Professional", actual: 383371, runRate: 445671 },
        { category: "Marketing", actual: 12000, runRate: 64000 },
        { category: "Travel", actual: 11800, runRate: 21000 },
      ].map((c) => ({ ...c, actual: Math.round(c.actual * scale), runRate: Math.round(c.runRate * scale) }));
      const sugg = proposals.filter((p) => p.status === "suggested");
      return {
        currency: entity.functionalCurrency,
        kpis: {
          categorySpend: categories.reduce((x, c) => x + c.actual, 0),
          runRate: categories.reduce((x, c) => x + c.runRate, 0),
          accruedLiabilities: Math.round(64500 * scale + proposals.filter((p) => p.status === "approved").reduce((x, p) => x + p.amount, 0)),
          prepaidAssets: Math.round(11500 * scale),
          needsAccrual: sugg.length,
          suggestedTotal: sugg.reduce((x, p) => x + p.amount, 0),
        },
        categories,
        proposals,
      };
    }),
  ),
  http.post(
    `${API}/accruals/:id/:action`,
    route(({ params, body }) => {
      const user = currentUser();
      const p = db().accruals.find((x) => x.id === params.id);
      if (!p) fail(404, "Proposal not found");
      const prop = p!;
      requirePerm(user, "je.prepare", prop.entityId);
      assertOpen(prop.entityId);
      if (prop.status !== "suggested") fail(409, "Already decided");
      if (params.action === "dismiss") {
        const reason = String(body.reason ?? "").trim();
        if (reason.length < 3) fail(422, "Reason required", "Say why this accrual isn't needed (AC-3).");
        prop.status = "dismissed";
        prop.dismissReason = reason;
        audit("accrual.dismissed", "accrual", prop.id, `Accrual for ${prop.vendor} dismissed: ${reason}`, { entityId: prop.entityId });
        return prop;
      }
      const amount = body.amount !== undefined ? Number(body.amount) : prop.amount;
      if (!(amount > 0)) fail(422, "Amount must be positive");
      const exp = acct(prop.entityId, prop.category.startsWith("Hosting") ? "60301004" : "61001002", "expense");
      const liab = acct(prop.entityId, "21001000", "liability");
      const d = newDraft(
        prop.entityId,
        {
          type: "accrual",
          sourceType: "accrual_proposal",
          sourceId: prop.id,
          sourceLabel: `Accrual · ${prop.vendor}`,
          description: `Accrual — ${prop.vendor} (${prop.category}), reverses 1 Sep 2026`,
          aiOutputId: prop.ai.id,
          lines: [
            { id: newId("jl"), lineNo: 1, accountId: exp.id, accountCode: exp.code, accountName: exp.name, debit: amount, credit: 0, memo: prop.vendor },
            { id: newId("jl"), lineNo: 2, accountId: liab.id, accountCode: liab.code, accountName: liab.name, debit: 0, credit: amount, memo: "Auto-reverse 1 Sep" },
          ],
        },
        user.id,
      );
      prop.status = "approved";
      prop.amount = amount;
      prop.draftId = d.id;
      audit("accrual.approved", "accrual", prop.id, `Accrual for ${prop.vendor} approved → draft ${d.number}`, { entityId: prop.entityId });
      return prop;
    }),
  ),

  // ---- recognition (F9, §10.1)
  http.get(
    `${API}/entities/:id/recognition`,
    route(({ params }): RecognitionView => {
      currentUser();
      const s = db();
      evaluateContracts(params.id);
      const contracts = s.contracts.filter((c) => c.entityId === params.id);
      const policy = s.autoApply.find((p) => p.entityId === params.id) ?? {
        entityId: params.id, enabled: false, version: 0, maxPerItem: 5000, maxPctOfRevenue: 0.5, minConfidence: 0.9, historyPeriods: 3, aggregateCap: 50000, pendingChange: null,
        sampling: { sampleSize: 0, checked: 0, errors: 0, errorRatePct: 0 },
      };
      const started = contracts.filter((c) => c.column === "started" || (c.column === "auto_applied" && c.batchSignedOff));
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const planned = [1.21, 1.24, 1.29, 1.31, 1.36, 1.41, 1.48, 1.56, 1.6, 1.64, 1.69, 1.75].map((x) => x * 1e6);
      const recognised = [1.2, 1.25, 1.27, 1.33, 1.35, 1.4, 1.47].map((x) => x * 1e6);
      const augRec = 450000 + started.reduce((x, c) => x + c.monthly, 0);
      return {
        monthly: months.map((m, i) => ({ month: m, planned: Math.round(planned[i]), recognised: i < 7 ? Math.round(recognised[i]) : i === 7 ? Math.round(augRec) : 0 })),
        kpis: {
          contractedArr: 25680000,
          deviations: contracts.filter((c) => c.column === "needs_review" && !c.decision).length + 115,
          complianceRead: 11,
          complianceTotal: 135,
          monthlyRevenue: 1560000,
          autoAppliedTotal: contracts.filter((c) => c.column === "auto_applied").reduce((x, c) => x + c.monthly, 0),
        },
        contracts,
        policy,
      };
    }),
  ),
  http.post(
    `${API}/contracts/:id/:action`,
    route(({ params, body }) => {
      const user = currentUser();
      const c = contractOr404(params.id);
      assertOpen(c.entityId);
      if (params.action === "decide") {
        requirePerm(user, "recognition.decide", c.entityId);
        const action = body.action === "defer" ? "defer" : "start";
        const justification = String(body.justification ?? "").trim();
        if (action !== c.recommendation.action && justification.length < 10) fail(422, "Justification required", "Overriding the AI recommendation needs a written justification (RR-6).", "justification_required");
        if (action === "defer" && justification.length < 10) fail(422, "Justification required", "Deferrals need a written justification (RR-6).", "justification_required");
        c.decision = { action, justification: justification || null, by: user.id, at: new Date().toISOString() };
        c.column = action === "defer" ? "deferred" : "started";
        audit(`contract.${action === "defer" ? "deferred" : "started"}`, "contract", c.id, `${c.customer}: ${action === "defer" ? "deferred to Sep" : "recognition started in Aug"}${justification ? ` — "${justification}"` : ""}`, { entityId: c.entityId });
        return c;
      }
      if (params.action === "pull-back") {
        requirePerm(user, "recognition.decide", c.entityId);
        if (c.column !== "auto_applied" || c.batchSignedOff) fail(409, "Can't pull back", "Only unsigned auto-applied items can be pulled back to review.");
        c.decision = { action: "pulled_back", justification: body.reason ?? null, by: user.id, at: new Date().toISOString() };
        c.column = "needs_review";
        audit("contract.pulled_back", "contract", c.id, `${c.customer} pulled back from auto-apply for line review`, { entityId: c.entityId });
        return c;
      }
      if (params.action === "reset") {
        requirePerm(user, "recognition.decide", c.entityId);
        c.decision = null;
        audit("contract.decision_reset", "contract", c.id, `${c.customer} decision withdrawn`, { entityId: c.entityId });
        evaluateContracts(c.entityId);
        return c;
      }
      return fail(404, "Unknown action");
    }),
  ),
  http.post(
    `${API}/entities/:id/recognition/auto-apply-batch/sign-off`,
    route(({ params }) => {
      const user = currentUser();
      requirePerm(user, "je.approve", params.id);
      assertOpen(params.id);
      evaluateContracts(params.id);
      const items = db().contracts.filter((c) => c.entityId === params.id && c.column === "auto_applied" && !c.batchSignedOff);
      if (!items.length) fail(409, "Nothing to sign off");
      const policy = db().autoApply.find((p) => p.entityId === params.id)!;
      items.forEach((c) => (c.batchSignedOff = true));
      audit("recognition.batch_signed_off", "auto_apply_batch", newId("aab"), `Batch sign-off of ${items.length} auto-applied items (${usd(items.reduce((x, c) => x + c.monthly, 0))}) under policy v${policy.version} by ${user.name}`, { entityId: params.id });
      return { signedOff: items.length };
    }),
  ),
  http.post(
    `${API}/entities/:id/recognition/policy/:action`,
    route(({ params, body }) => {
      const user = currentUser();
      requirePerm(user, "recognition.policy", params.id);
      const s = db();
      const p = s.autoApply.find((x) => x.entityId === params.id);
      if (!p) fail(404, "No policy for this entity");
      const policy = p!;
      if (params.action === "kill-switch") {
        policy.enabled = !!body.enabled;
        audit("auto_apply.kill_switch", "auto_apply_policy", params.id, `Auto-apply ${policy.enabled ? "re-enabled" : "switched OFF"} by ${user.name}`, { entityId: params.id });
        evaluateContracts(params.id);
        return policy;
      }
      if (params.action === "propose") {
        const next = {
          enabled: policy.enabled,
          version: policy.version + 1,
          maxPerItem: Number(body.maxPerItem),
          maxPctOfRevenue: Number(body.maxPctOfRevenue),
          minConfidence: Number(body.minConfidence),
          historyPeriods: Number(body.historyPeriods ?? policy.historyPeriods),
          aggregateCap: Number(body.aggregateCap),
          proposedBy: user.id,
          approvals: [user.id],
        };
        if (!(next.maxPerItem >= 0) || !(next.aggregateCap >= next.maxPerItem)) fail(422, "Invalid limits", "The aggregate cap must be at least the per-item limit.");
        if (!(next.minConfidence >= 0.8 && next.minConfidence <= 1)) fail(422, "Invalid confidence", "Minimum confidence can't be set below 0.80 (§10.1).");
        policy.pendingChange = next;
        audit("auto_apply.change_proposed", "auto_apply_policy", params.id, `Policy v${next.version} proposed by ${user.name}: ${usd(next.maxPerItem)} per item, cap ${usd(next.aggregateCap)}, confidence ≥ ${next.minConfidence}`, { entityId: params.id });
        return policy;
      }
      if (params.action === "approve") {
        if (!policy.pendingChange) fail(409, "No pending change");
        if (policy.pendingChange!.approvals.includes(user.id)) fail(403, "Second approver required", "A different Controller or the CFO must approve the change (§10.1).", "sod_policy");
        const { proposedBy: _pb, approvals: _ap, ...rest } = policy.pendingChange!;
        void _pb;
        void _ap;
        Object.assign(policy, rest, { pendingChange: null });
        audit("auto_apply.change_approved", "auto_apply_policy", params.id, `Policy v${policy.version} approved by ${user.name} and now in effect`, { entityId: params.id });
        evaluateContracts(params.id);
        return policy;
      }
      if (params.action === "discard") {
        policy.pendingChange = null;
        audit("auto_apply.change_discarded", "auto_apply_policy", params.id, "Pending policy change discarded", { entityId: params.id });
        return policy;
      }
      if (params.action === "sample") {
        policy.sampling.checked = Math.min(policy.sampling.sampleSize, policy.sampling.checked + 1);
        if (body.error) policy.sampling.errors += 1;
        policy.sampling.errorRatePct = Math.round((policy.sampling.errors / Math.max(policy.sampling.checked, 1)) * 1000) / 10;
        if (policy.sampling.errorRatePct > 2 && policy.sampling.checked >= 3) {
          policy.enabled = false;
          audit("auto_apply.disabled_by_sampling", "auto_apply_policy", params.id, `Sample error rate ${policy.sampling.errorRatePct}% > 2% — auto-apply switched off pending Controller review`, { entityId: params.id, actorType: "system", actorId: null });
          evaluateContracts(params.id);
        }
        return policy;
      }
      return fail(404, "Unknown action");
    }),
  ),

  // ---- copilot (streams over SSE)
  http.post(`${API}/copilot/ask`, async ({ request }) => {
    let body: { question?: string; entityId?: string | null } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      /* empty */
    }
    let result: ReturnType<typeof answer>;
    try {
      result = answer(String(body.question ?? ""), body.entityId ?? null);
    } catch {
      return HttpResponse.json({ type: "about:blank", title: "Not signed in", status: 401 } as never, { status: 401 });
    }
    const o = newAi({ kind: "copilot_answer", text: result.text, citations: result.citations, outcome: result.outcome, promptVersion: "copilot@2" });
    audit("copilot.answered", "ai_output", o.id, `Copilot answered: "${String(body.question).slice(0, 60)}"`, { actorType: "user" });
    const encoder = new TextEncoder();
    const words = result.text.split(/(\s+)/);
    const stream = new ReadableStream({
      async start(controller) {
        for (let i = 0; i < words.length; i += 3) {
          controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify(words.slice(i, i + 3).join(""))}\n\n`));
          await new Promise((r) => setTimeout(r, 25));
        }
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ citations: result.citations, outcome: result.outcome, aiOutputId: o.id, modelId: o.modelId })}\n\n`));
        controller.close();
      },
    });
    return new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream" } });
  }),

  // ---- consolidation (F11)
  http.get(`${API}/consolidation`, route(() => (currentUser(), consolidationView()))),
  http.post(
    `${API}/consolidation/translation-run`,
    route(() => {
      const user = currentUser();
      requirePerm(user, "consolidation.manage");
      return startJob("translation_run", 3000, ["Loading closing and average rates", "Translating balance sheets at closing rate", "Translating P&L at average rate", "Posting CTA to OCI"], () => {
        db().consolidation.translationRun = true;
        audit("consolidation.translated", "consolidation", DEMO.period, "Currency translation run (BS at closing, P&L at average, CTA to OCI)", { actorId: user.id });
      });
    }),
  ),
  http.post(
    `${API}/ic-matches/:id/true-up`,
    route(({ params }) => {
      const user = currentUser();
      const s = db();
      const m = s.consolidation.matches.find((x) => x.id === params.id);
      if (!m) fail(404, "Match not found");
      const match = m!;
      if (match.status !== "mismatch") fail(409, "Not a mismatch");
      if (match.trueUpDraftId) fail(409, "True-up already drafted");
      const target = match.likelyCause === "timing" ? match.toEntityId : match.toEntityId;
      requirePerm(user, "je.prepare", target);
      const ic = acct(target, "23001000", "liability");
      const exp = acct(target, "61001002", "expense");
      const ent = s.entities.find((e) => e.id === target)!;
      const rate = ent.functionalCurrency === "USD" ? 1 : s.consolidation.rates.find((r) => r.ccy === ent.functionalCurrency)!.closing;
      const amount = Math.round((match.difference / rate) * 100) / 100;
      const o = newAi({ kind: "ic_mismatch", text: match.explanation, confidence: 0.86, citations: [{ recordType: "ic_match", recordId: match.id, label: `IC match ${match.id}` }] });
      const d = newDraft(
        target,
        {
          type: "correction",
          sourceType: "ic_true_up",
          sourceId: match.id,
          sourceLabel: `IC true-up · ${match.id}`,
          description: `Intercompany true-up (${match.likelyCause}) for ${match.id}`,
          aiOutputId: o.id,
          lines: [
            { id: newId("jl"), lineNo: 1, accountId: exp.id, accountCode: exp.code, accountName: exp.name, debit: amount, credit: 0, memo: "IC true-up" },
            { id: newId("jl"), lineNo: 2, accountId: ic.id, accountCode: ic.code, accountName: ic.name, debit: 0, credit: amount, memo: "IC true-up" },
          ],
        },
        user.id,
      );
      match.trueUpDraftId = d.id;
      audit("ic.true_up_drafted", "ic_match", match.id, `IC true-up ${d.number} drafted in ${ent.name} (${ent.functionalCurrency} ${amount.toLocaleString()})`, { entityId: target });
      return { match, draft: toDraft(d) };
    }),
  ),
  http.post(
    `${API}/eliminations/:id/approve`,
    route(({ params }) => {
      const user = currentUser();
      requirePerm(user, "consolidation.manage");
      const e = db().consolidation.eliminations.find((x) => x.id === params.id);
      if (!e) fail(404, "Elimination not found");
      if (e!.status !== "proposed") fail(409, "Already approved");
      if (e!.preparedBy === user.id) fail(403, "Segregation of duties", "You prepared this elimination.");
      e!.status = "posted";
      e!.approvedBy = user.id;
      audit("elimination.approved", "elimination", e!.id, `${e!.description} (${usd(e!.amount)}) approved and posted to the consolidation layer`, {});
      return e;
    }),
  ),
  http.post(
    `${API}/consolidation/:action`,
    route(({ params }) => {
      const user = currentUser();
      requirePerm(user, "consolidation.manage");
      const c = db().consolidation;
      const view = consolidationView();
      if (params.action === "review") {
        if (!c.translationRun) fail(409, "Run translation first");
        c.reviewed = true;
        audit("consolidation.reviewed", "consolidation", DEMO.period, `Consolidated statements reviewed by ${user.name}`);
        return consolidationView();
      }
      if (params.action === "lock") {
        const blocking = view.steps.filter((s) => s.key !== "lock" && !s.done);
        if (blocking.length) fail(409, "Steps not complete", blocking.map((b) => b.label).join(", ") + " must be done first.");
        const unlocked = db().entities.filter((e) => e.status === "active" && periodOf(e.id).status !== "locked");
        if (unlocked.length) fail(409, "Entity periods still open", `Lock every entity first (CO-7): ${unlocked.map((e) => e.name).join(", ")}.`, "entities_unlocked");
        c.status = "locked";
        audit("consolidation.locked", "consolidation", DEMO.period, `Consolidated Aug 2026 signed off and locked by ${user.name}`);
        return consolidationView();
      }
      return fail(404, "Unknown action");
    }),
  ),
  // keep entitySummary referenced for tree-shaking clarity in mocks
  http.get(`${API}/entities/:id/summary`, route(({ params }) => entitySummary(params.id))),
];
