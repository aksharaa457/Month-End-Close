import { http } from "msw";
import type { ContextNote, FluxView, JeList, JeStatus } from "@/shared/api/types";
import { DEMO, db, newId, type DraftRow } from "../db";
import {
  assertCanApprove,
  assertOpen,
  audit,
  can,
  currentUser,
  draftOr404,
  fail,
  newAi,
  requirePerm,
  thresholdFor,
  toDraft,
  userName,
  variancesFor,
} from "../logic";
import { API, route, startJob } from "./core";

function varianceOr404(id: string) {
  const a = db().accounts.find((x) => x.id === id);
  if (!a) fail(404, "Variance not found");
  const v = variancesFor(a!.entityId).find((x) => x.id === id)!;
  return { a: a!, v };
}

function metaFor(id: string) {
  const s = db();
  s.varianceMeta[id] ??= { status: "auto", explanationId: null, signedOffBy: null, exceptionReason: null, changedAfterSignoff: false, version: 1, needsEntry: null };
  return s.varianceMeta[id];
}

/** Rewrites an explanation using approved context (FX-5). Mock of the AI gateway call. */
function explainWithContext(accountId: string, notes: ContextNote[], preview = false) {
  const { v } = varianceOr404(accountId);
  const base = v.explanation?.text ?? "";
  const ctx = notes.map((n) => `"${n.text}"`).join("; ");
  const text = `${notes.length} context note${notes.length > 1 ? "s" : ""} applied (${ctx}). Taking this into account, the ${v.accountName} movement of ${v.delta.toLocaleString("en-US", { style: "currency", currency: v.currency })} is consistent with expected timing rather than an error. ${base ? `Underlying data: ${base}` : ""}`.trim();
  return newAi({
    kind: preview ? "context_preview" : "variance_explanation",
    text,
    confidence: 0.9,
    citations: [...(v.explanation?.citations ?? []), ...notes.map((n) => ({ recordType: "context_note" as const, recordId: n.id, label: `AI context: ${n.text.slice(0, 40)}` }))],
    contextNoteIds: notes.map((n) => n.id),
    promptVersion: "flux-explain@3",
  });
}

const EMPTY_BY_STATUS = (): JeList["summary"]["byStatus"] =>
  Object.fromEntries((["draft", "submitted", "approved", "rejected", "posting", "posted", "post_failed", "withdrawn"] as JeStatus[]).map((k) => [k, { count: 0, total: 0 }])) as JeList["summary"]["byStatus"];

function mkDraftFromVariance(entityId: string, accountId: string, type: DraftRow["type"], amount: number, offsetCode: string, preparerId: string | null) {
  const s = db();
  const src = s.accounts.find((a) => a.id === accountId)!;
  const off = s.accounts.find((a) => a.entityId === entityId && a.code === offsetCode) ?? s.accounts.find((a) => a.entityId === entityId && !a.isGroup && a.accountClass === "liability")!;
  const debitSrc = src.accountClass === "expense" || src.accountClass === "asset";
  const entity = s.entities.find((e) => e.id === entityId)!;
  const policy = s.approvalPolicies.filter((p) => p.entityId === entityId).sort((a, b) => b.version - a.version)[0];
  s.draftSeq += 1;
  const o = newAi({
    kind: "je_draft",
    text: `Drafted a ${type} of ${amount.toLocaleString("en-US", { style: "currency", currency: entity.functionalCurrency })} for ${src.code} ${src.name}, based on the August variance and its explanation.`,
    citations: [{ recordType: "variance", recordId: src.id, label: `${src.code} ${src.name} variance` }],
    confidence: 0.88,
  });
  const d: DraftRow = {
    id: `je-${s.draftSeq}`,
    number: `JE-${s.draftSeq}`,
    entityId,
    periodId: `p-${entityId}-2026-08`,
    type,
    sourceType: "variance",
    sourceId: src.id,
    sourceLabel: `${src.code} ${src.name}`,
    description: `${type[0].toUpperCase()}${type.slice(1)} — ${src.code} ${src.name}, per Aug 2026 variance review`,
    status: "draft",
    createdByAi: true,
    aiOutputId: o.id,
    preparerId,
    currency: entity.functionalCurrency,
    lines: [
      { id: newId("jl"), lineNo: 1, accountId: debitSrc ? src.id : off.id, accountCode: debitSrc ? src.code : off.code, accountName: debitSrc ? src.name : off.name, debit: amount, credit: 0, memo: "" },
      { id: newId("jl"), lineNo: 2, accountId: debitSrc ? off.id : src.id, accountCode: debitSrc ? off.code : src.code, accountName: debitSrc ? off.name : src.name, debit: 0, credit: amount, memo: "" },
    ],
    requiresSecondApproval: amount > policy.secondApprovalAbove,
    version: 1,
    approvals: [],
    postingAttempts: [],
    erpDocNumber: null,
    sourceChanged: false,
    createdAt: new Date().toISOString(),
  };
  s.drafts.push(d);
  return d;
}

function postDraft(d: DraftRow) {
  const s = db();
  const entity = s.entities.find((e) => e.id === d.entityId)!;
  const attemptNo = d.postingAttempts.length + 1;
  const doc = `${entity.erpType === "sap" ? "SAP-FI" : "NS-JE"}-${48300 + Math.floor(Math.random() * 600)}`;
  d.postingAttempts.push({ attemptNo, status: "succeeded", erpDocNumber: doc, error: null, at: new Date().toISOString() });
  d.status = "posted";
  d.erpDocNumber = doc;
  audit("je_draft.posted", "je_draft", d.id, `${d.number} posted to ${entity.erpType === "sap" ? "SAP" : "NetSuite"} as ${doc} (idempotency key ${d.id}:v${d.version})`, { entityId: d.entityId, actorType: "system", actorId: null });
}

export const fluxHandlers = [
  // ---- flux view (FX-1, FX-2)
  http.get(
    `${API}/entities/:id/periods/:period/variances`,
    route(({ params }): FluxView => {
      currentUser();
      const variances = variancesFor(params.id);
      const flagged = variances.filter((v) => v.isFlagged);
      return {
        period: DEMO.period,
        priorPeriod: DEMO.priorPeriod,
        threshold: thresholdFor(params.id),
        variances,
        counts: { flagged: flagged.length, total: variances.length, signedOff: flagged.filter((v) => v.status === "signed_off" || v.status === "exception").length },
      };
    }),
  ),
  http.get(`${API}/variances/:id`, route(({ params }) => varianceOr404(params.id).v)),
  http.get(
    `${API}/variances/:id/lines`,
    route(({ params }) => {
      const s = db();
      const ids = new Set<string>([params.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const a of s.accounts) if (a.parentId && ids.has(a.parentId) && !ids.has(a.id)) { ids.add(a.id); grew = true; }
      }
      return s.glLines.filter((g) => ids.has(g.accountId)).sort((a, b) => b.postingDate.localeCompare(a.postingDate));
    }),
  ),
  http.post(
    `${API}/variances/:id/sign-off`,
    route(({ params, body }) => {
      const user = currentUser();
      const { a, v } = varianceOr404(params.id);
      requirePerm(user, "task.signoff", a.entityId);
      assertOpen(a.entityId);
      if (!v.isFlagged) fail(409, "Not flagged", "Only flagged lines need sign-off.");
      if (v.status === "signed_off" || v.status === "exception") fail(409, "Already signed off");
      if (body.version !== undefined && body.version !== v.version) fail(409, "Variance changed", "Reload to see the latest explanation.", "stale_version");
      if (v.status === "needs_manual" && !String(body.manualExplanation ?? "").trim())
        fail(422, "Explanation required", "This line has no usable AI explanation. Write a manual explanation before signing off (EC-8).", "manual_required");
      const m = metaFor(params.id);
      if (body.manualExplanation) {
        const o = newAi({ kind: "variance_explanation", text: String(body.manualExplanation), confidence: null, modelId: "manual", promptVersion: "manual", inferenceRegion: "n/a" });
        m.explanationId = o.id;
      }
      m.status = "signed_off";
      m.signedOffBy = user.id;
      m.changedAfterSignoff = false;
      m.version += 1;
      audit("variance.signed_off", "variance", params.id, `${a.code} ${a.name} signed off`, { entityId: a.entityId });
      return varianceOr404(params.id).v;
    }),
  ),
  http.post(
    `${API}/variances/:id/exception`,
    route(({ params, body }) => {
      const user = currentUser();
      const { a, v } = varianceOr404(params.id);
      requirePerm(user, "task.signoff", a.entityId);
      assertOpen(a.entityId);
      if (!v.isFlagged) fail(409, "Not flagged");
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 10) fail(422, "Reason required", "Describe the exception (at least 10 characters).");
      const m = metaFor(params.id);
      m.status = "exception";
      m.exceptionReason = reason;
      m.signedOffBy = user.id;
      m.version += 1;
      audit("variance.exception_approved", "variance", params.id, `${a.code} ${a.name}: approved exception — ${reason}`, { entityId: a.entityId });
      return varianceOr404(params.id).v;
    }),
  ),
  http.post(
    `${API}/variances/:id/reopen`,
    route(({ params }) => {
      const user = currentUser();
      const { a } = varianceOr404(params.id);
      requirePerm(user, "task.signoff", a.entityId);
      assertOpen(a.entityId);
      const m = metaFor(params.id);
      m.status = m.explanationId ? "explained" : "auto";
      m.signedOffBy = null;
      m.exceptionReason = null;
      m.version += 1;
      audit("variance.reopened", "variance", params.id, `${a.code} ${a.name} sign-off withdrawn`, { entityId: a.entityId });
      return varianceOr404(params.id).v;
    }),
  ),

  // ---- AI context (FX-5, FX-6, §10.2)
  http.post(
    `${API}/variances/:id/context-notes`,
    route(({ params, body }) => {
      const user = currentUser();
      const { a, v } = varianceOr404(params.id);
      requirePerm(user, "context.propose", a.entityId);
      const text = String(body.text ?? "").trim();
      if (text.length < 3 || text.length > 2000) fail(422, "Context must be 3–2,000 characters");
      const scope: ContextNote["scope"] = body.scope === "account_group" || body.scope === "cross_entity" ? body.scope : "account";
      const note: ContextNote = {
        id: newId("cn"),
        scope,
        entityId: scope === "cross_entity" ? null : a.entityId,
        accountId: a.id,
        accountLabel: `${a.code} · ${a.name}`,
        text,
        status: "pending",
        proposedBy: user.id,
        proposedAt: new Date().toISOString(),
        decidedBy: null,
        decidedAt: null,
        reviewBy: body.noExpiry ? null : body.reviewBy || "2027-09-01",
        changesMaterialConclusion: v.isFlagged && Math.abs(v.delta) > thresholdFor(a.entityId).absAmount,
        version: 1,
        appliedToVarianceIds: [],
        previewExplanation: null,
      };
      note.previewExplanation = explainWithContext(a.id, [note], true).text;
      db().contextNotes.push(note);
      audit("context_note.proposed", "context_note", note.id, `AI context proposed on ${note.accountLabel}: "${text}"`, { entityId: a.entityId });
      return note;
    }),
  ),
  http.get(
    `${API}/context-notes`,
    route(({ url }) => {
      currentUser();
      const status = url.searchParams.get("status");
      const accountId = url.searchParams.get("accountId");
      const entityId = url.searchParams.get("entityId");
      return db()
        .contextNotes.filter((n) => (!status || n.status === status) && (!accountId || n.accountId === accountId) && (!entityId || n.entityId === entityId || n.entityId === null))
        .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt));
    }),
  ),
  http.patch(
    `${API}/context-notes/:id`,
    route(({ params, body }) => {
      const user = currentUser();
      const n = db().contextNotes.find((x) => x.id === params.id);
      if (!n) fail(404, "Context note not found");
      const note = n!;
      requirePerm(user, "context.propose", note.entityId);
      if (note.status !== "pending" && note.status !== "approved") fail(409, "Can't edit", "Only pending or approved context can be edited.");
      if (body.version !== undefined && body.version !== note.version) fail(409, "Context changed", "Someone else edited this note. Reload first.", "stale_version");
      const text = String(body.text ?? note.text).trim();
      if (text.length < 3 || text.length > 2000) fail(422, "Context must be 3–2,000 characters");
      const wasApproved = note.status === "approved";
      note.text = text;
      if (body.reviewBy !== undefined) note.reviewBy = body.reviewBy || null;
      note.version += 1;
      note.status = "pending";
      note.proposedBy = user.id;
      note.proposedAt = new Date().toISOString();
      note.decidedBy = null;
      note.decidedAt = null;
      if (note.accountId) note.previewExplanation = explainWithContext(note.accountId, [note], true).text;
      if (wasApproved && note.accountId) {
        const m = metaFor(note.accountId);
        if (m.status === "explained") m.status = "auto";
      }
      audit("context_note.edited", "context_note", note.id, `AI context edited to v${note.version}${wasApproved ? " (was approved — no longer applied until re-approved)" : ""}: "${text}"`, { entityId: note.entityId });
      return note;
    }),
  ),
  http.post(
    `${API}/context-notes/:id/:decision`,
    route(({ params, body }) => {
      const user = currentUser();
      const n = db().contextNotes.find((x) => x.id === params.id);
      if (!n) fail(404, "Context note not found");
      const note = n!;
      const broad = note.scope !== "account" || note.changesMaterialConclusion || note.reviewBy === null;
      if (params.decision === "retire") {
        if (!can(user, "context.approve.broad", note.entityId) && !can(user, "context.approve.account", note.entityId)) fail(403, "Not allowed");
        if (note.status !== "approved") fail(409, "Only approved context can be retired");
        note.status = "retired";
        note.retiredBy = user.id;
        if (note.accountId && db().varianceMeta[note.accountId]?.status === "explained") {
          const m = metaFor(note.accountId);
          m.status = "auto";
        }
        audit("context_note.retired", "context_note", note.id, `AI context retired: "${note.text}"`, { entityId: note.entityId });
        return note;
      }
      if (note.status !== "pending") fail(409, "Already decided");
      if (note.proposedBy === user.id) fail(403, "Segregation of duties", "You proposed this context, so someone else must approve it (§10.2).", "sod_context");
      if (broad) requirePerm(user, "context.approve.broad", note.entityId);
      else if (!can(user, "context.approve.account", note.entityId)) fail(403, "Not allowed", "Only the account owner/reviewer or a Controller can approve context.");
      if (params.decision === "reject") {
        note.status = "rejected";
        note.decisionReason = body.reason ? String(body.reason) : null;
        note.decidedBy = user.id;
        note.decidedAt = new Date().toISOString();
        audit("context_note.rejected", "context_note", note.id, `AI context rejected${body.reason ? `: ${body.reason}` : ""}`, { entityId: note.entityId });
        return note;
      }
      note.status = "approved";
      note.decidedBy = user.id;
      note.decidedAt = new Date().toISOString();
      if (note.accountId) {
        const approved = db().contextNotes.filter((x) => x.status === "approved" && x.accountId === note.accountId);
        const o = explainWithContext(note.accountId, approved);
        const m = metaFor(note.accountId);
        m.explanationId = o.id;
        if (m.status !== "signed_off" && m.status !== "exception") m.status = "explained";
        else m.changedAfterSignoff = true;
        m.version += 1;
        note.appliedToVarianceIds = [note.accountId];
      }
      audit("context_note.approved", "context_note", note.id, `AI context approved by ${user.name}; explanation regenerated for ${note.accountLabel}`, { entityId: note.entityId });
      return note;
    }),
  ),

  // ---- journals (JE-1..JE-6)
  http.get(
    `${API}/entities/:id/periods/:period/je-drafts`,
    route(({ params }): JeList => {
      currentUser();
      const s = db();
      const drafts = s.drafts.filter((d) => d.entityId === params.id).map(toDraft).sort((a, b) => b.number.localeCompare(a.number));
      const byStatus = EMPTY_BY_STATUS();
      for (const d of drafts) {
        byStatus[d.status].count += 1;
        byStatus[d.status].total += d.totalDebit;
      }
      const live = drafts.filter((d) => d.status !== "withdrawn" && d.status !== "rejected");
      return {
        drafts,
        summary: { count: live.length, total: Math.round(live.reduce((x, d) => x + d.totalDebit, 0) * 100) / 100, byStatus },
        policy: s.approvalPolicies.filter((p) => p.entityId === params.id).sort((a, b) => b.version - a.version)[0],
      };
    }),
  ),
  http.get(`${API}/je-drafts/:id`, route(({ params }) => toDraft(draftOr404(params.id)))),
  http.get(
    `${API}/entities/:id/periods/:period/je-candidates`,
    route(({ params }) => {
      currentUser();
      const s = db();
      return variancesFor(params.id)
        .filter((v) => v.isFlagged && !v.isGroup && s.varianceMeta[v.id]?.needsEntry && v.draftIds.length === 0)
        .map((v) => ({ varianceId: v.id, label: `${v.accountCode} ${v.accountName}`, ...s.varianceMeta[v.id].needsEntry! }));
    }),
  ),
  http.post(
    `${API}/entities/:id/periods/:period/je-drafts/generate`,
    route(({ params }) => {
      const user = currentUser();
      requirePerm(user, "je.prepare", params.id);
      assertOpen(params.id);
      const s = db();
      const flagged = variancesFor(params.id).filter((v) => v.isFlagged && !v.isGroup);
      const candidates = flagged.filter((v) => s.varianceMeta[v.id]?.needsEntry && v.draftIds.length === 0);
      return startJob("generate_drafts", 2500 + candidates.length * 500, ["Reading flagged lines and explanations", "Drafting entries with the AI gateway", "Validating: balanced, accounts open, period open", "Saving drafts"], () => {
        const created: string[] = [];
        for (const v of candidates) {
          const n = s.varianceMeta[v.id].needsEntry!;
          const d = mkDraftFromVariance(params.id, v.id, n.type, n.amount, n.offsetCode, user.id);
          s.varianceMeta[v.id].needsEntry = null;
          created.push(d.id);
          audit("je_draft.created", "je_draft", d.id, `${d.number} drafted by AI from ${d.sourceLabel} (${n.type})`, { entityId: params.id, actorType: "ai", actorId: null });
        }
        return { created: created.length, flagged: flagged.length, skipped: flagged.length - created.length };
      });
    }),
  ),
  http.post(
    `${API}/entities/:id/periods/:period/je-drafts`,
    route(({ params, body }) => {
      const user = currentUser();
      requirePerm(user, "je.prepare", params.id);
      assertOpen(params.id);
      const s = db();
      const entity = s.entities.find((e) => e.id === params.id)!;
      s.draftSeq += 1;
      const d: DraftRow = {
        id: `je-${s.draftSeq}`,
        number: `JE-${s.draftSeq}`,
        entityId: params.id,
        periodId: `p-${params.id}-2026-08`,
        type: body.type ?? "correction",
        sourceType: "manual",
        sourceId: null,
        sourceLabel: null,
        description: String(body.description ?? "Manual journal entry"),
        status: "draft",
        createdByAi: false,
        aiOutputId: null,
        preparerId: user.id,
        currency: entity.functionalCurrency,
        lines: [],
        requiresSecondApproval: false,
        version: 1,
        approvals: [],
        postingAttempts: [],
        erpDocNumber: null,
        sourceChanged: false,
        createdAt: new Date().toISOString(),
      };
      s.drafts.push(d);
      audit("je_draft.created", "je_draft", d.id, `${d.number} created manually`, { entityId: params.id });
      return toDraft(d);
    }),
  ),
  http.patch(
    `${API}/je-drafts/:id`,
    route(({ params, body }) => {
      const user = currentUser();
      const d = draftOr404(params.id);
      requirePerm(user, "je.prepare", d.entityId);
      assertOpen(d.entityId);
      if (!["draft", "rejected"].includes(d.status)) fail(409, "Entry is locked", "Lines can't change once an entry is submitted (JE-6).", "lines_frozen");
      if (body.version !== d.version) fail(409, "Entry changed", `Someone else saved v${d.version}. Reload before editing.`, "stale_version");
      const s = db();
      if (Array.isArray(body.lines)) {
        d.lines = body.lines.map((l: { accountId: string; debit: number; credit: number; memo?: string }, i: number) => {
          const acct = s.accounts.find((a) => a.id === l.accountId && a.entityId === d.entityId && !a.isGroup);
          if (!acct) fail(422, "Unknown account", `Line ${i + 1}: choose a posting account.`);
          const debit = Math.round(Number(l.debit || 0) * 100) / 100;
          const credit = Math.round(Number(l.credit || 0) * 100) / 100;
          if (debit < 0 || credit < 0 || (debit > 0) === (credit > 0)) fail(422, "Invalid line", `Line ${i + 1} must have either a debit or a credit.`);
          return { id: newId("jl"), lineNo: i + 1, accountId: acct!.id, accountCode: acct!.code, accountName: acct!.name, debit, credit, memo: String(l.memo ?? "") };
        });
      }
      if (body.description !== undefined) d.description = String(body.description);
      if (body.type) d.type = body.type;
      d.status = "draft";
      d.preparerId = user.id; // whoever last edited becomes the preparer (SOD)
      d.version += 1;
      const total = d.lines.reduce((x, l) => x + l.debit, 0);
      const policy = s.approvalPolicies.filter((p) => p.entityId === d.entityId).sort((a, b) => b.version - a.version)[0];
      d.requiresSecondApproval = total > policy.secondApprovalAbove;
      audit("je_draft.edited", "je_draft", d.id, `${d.number} edited (v${d.version}) by ${user.name}`, { entityId: d.entityId });
      return toDraft(d);
    }),
  ),
  http.post(
    `${API}/je-drafts/:id/:action`,
    route(({ params, body }) => {
      const user = currentUser();
      const d = draftOr404(params.id);
      assertOpen(d.entityId);
      switch (params.action) {
        case "submit": {
          requirePerm(user, "je.prepare", d.entityId);
          if (!["draft", "rejected"].includes(d.status)) fail(409, "Can't submit", `Entry is ${d.status}.`);
          const dr = d.lines.reduce((x, l) => x + l.debit, 0);
          const cr = d.lines.reduce((x, l) => x + l.credit, 0);
          if (d.lines.length < 2) fail(422, "Needs at least 2 lines", undefined, "too_few_lines");
          if (Math.round(dr * 100) !== Math.round(cr * 100)) fail(422, "Entry doesn't balance", `Debits ${dr.toLocaleString()} ≠ credits ${cr.toLocaleString()} (JE-6).`, "unbalanced");
          d.status = "submitted";
          d.preparerId = d.preparerId ?? user.id;
          if (!d.preparerId || d.createdByAi) d.preparerId = d.preparerId ?? user.id;
          audit("je_draft.submitted", "je_draft", d.id, `${d.number} submitted for approval by ${user.name}`, { entityId: d.entityId });
          break;
        }
        case "approve": {
          assertCanApprove(user, d, Number(body.version));
          const level1 = d.approvals.find((a) => a.level === 1 && a.decision === "approved" && a.draftVersion === d.version);
          const level: 1 | 2 = level1 ? 2 : 1;
          d.approvals.push({ id: newId("apr"), level, approverId: user.id, decision: "approved", draftVersion: d.version, comment: body.comment ?? null, decidedAt: new Date().toISOString(), batchId: null });
          const needed = d.requiresSecondApproval ? 2 : 1;
          const have = d.approvals.filter((a) => a.decision === "approved" && a.draftVersion === d.version).length;
          audit("je_draft.approved", "je_draft", d.id, `${d.number} level ${level} approval by ${user.name}${have < needed ? " — awaiting second approver" : ""}`, { entityId: d.entityId });
          if (have >= needed) {
            d.status = "approved";
            d.status = "posting";
            postDraft(d);
          }
          break;
        }
        case "reject": {
          requirePerm(user, "je.approve", d.entityId);
          if (d.status !== "submitted") fail(409, "Not awaiting approval");
          if (d.preparerId === user.id) fail(403, "Segregation of duties", "You can't decide on an entry you prepared.");
          const reason = String(body.comment ?? "").trim();
          if (reason.length < 3) fail(422, "Reason required", "Say why you're rejecting the entry.");
          d.approvals.push({ id: newId("apr"), level: 1, approverId: user.id, decision: "rejected", draftVersion: d.version, comment: reason, decidedAt: new Date().toISOString(), batchId: null });
          d.status = "rejected";
          audit("je_draft.rejected", "je_draft", d.id, `${d.number} rejected: ${reason}`, { entityId: d.entityId });
          break;
        }
        case "withdraw": {
          requirePerm(user, "je.prepare", d.entityId);
          if (!["draft", "rejected", "submitted"].includes(d.status)) fail(409, "Can't withdraw", `Entry is ${d.status}.`);
          d.status = "withdrawn";
          if (d.sourceType === "variance" && d.sourceId) {
            const m = metaFor(d.sourceId);
            m.needsEntry = null;
          }
          audit("je_draft.withdrawn", "je_draft", d.id, `${d.number} withdrawn by ${user.name}`, { entityId: d.entityId });
          break;
        }
        case "retry-posting": {
          if (!can(user, "je.approve", d.entityId) && !can(user, "je.prepare", d.entityId)) fail(403, "Not allowed");
          if (d.status !== "post_failed") fail(409, "Nothing to retry");
          // Unknown outcomes are resolved by lookup first, never blind re-posting (ARCH §7.3).
          audit("je_draft.post_retry", "je_draft", d.id, `${d.number}: looked up external ID ${d.id}:v${d.version} in ERP — not found; retrying with the same key`, { entityId: d.entityId, actorType: "system", actorId: null });
          postDraft(d);
          break;
        }
        default:
          fail(404, "Unknown action");
      }
      return toDraft(d);
    }),
  ),
  http.post(
    `${API}/je-batches/approve`,
    route(({ body }) => {
      const user = currentUser();
      const items: { id: string; version: number }[] = body.items ?? [];
      if (!items.length) fail(422, "Nothing selected");
      const drafts = items.map((i) => ({ d: draftOr404(i.id), v: i.version }));
      // Validate every entry before changing anything (all-or-nothing approval; per-entry posting).
      for (const { d, v } of drafts) {
        assertOpen(d.entityId);
        assertCanApprove(user, d, v);
      }
      const batchId = newId("batch");
      const toPost: DraftRow[] = [];
      for (const { d } of drafts) {
        const level1 = d.approvals.find((a) => a.level === 1 && a.decision === "approved" && a.draftVersion === d.version);
        const level: 1 | 2 = level1 ? 2 : 1;
        d.approvals.push({ id: newId("apr"), level, approverId: user.id, decision: "approved", draftVersion: d.version, comment: null, decidedAt: new Date().toISOString(), batchId });
        const have = d.approvals.filter((a) => a.decision === "approved" && a.draftVersion === d.version).length;
        if (have >= (d.requiresSecondApproval ? 2 : 1)) {
          d.status = "posting";
          toPost.push(d);
        }
        audit("je_draft.approved", "je_draft", d.id, `${d.number} level ${level} approval by ${user.name} (batch of ${drafts.length})`, { entityId: d.entityId });
      }
      return startJob("post_batch", 1500 + toPost.length * 400, ["Queuing posting jobs", "Posting to ERP with idempotency keys", "Reading back document numbers"], () => {
        toPost.forEach(postDraft);
        return { approved: drafts.length, posted: toPost.length, awaitingSecond: drafts.length - toPost.length };
      });
    }),
  ),
];

export { userName };
