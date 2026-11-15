import { http } from "msw";
import type { CloseSummary, Comment, PeriodDetail, Phase } from "@/shared/api/types";
import { DEMO, db, newId } from "../db";
import { assertOpen, audit, can, currentUser, entitySummary, fail, forecastFor, lockGates, periodOf, projection, requirePerm, toTask, userName, variancesFor } from "../logic";
import { API, route } from "./core";

const PHASES: Phase[] = ["pre_close", "reconciliations", "accruals", "intercompany", "compliance", "board_pack"];

function taskOr404(id: string) {
  const t = db().tasks.find((x) => x.id === id);
  if (!t) fail(404, "Task not found");
  return t!;
}

function findSubtask(id: string) {
  for (const t of db().tasks) {
    const s = t.subtasks.find((x) => x.id === id);
    if (s) return { task: t, sub: s };
  }
  return fail(404, "Subtask not found");
}

export const closeHandlers = [
  // ---- close summary (HUB-1, HUB-3, HUB-5)
  http.get(
    `${API}/close/summary`,
    route((): CloseSummary => {
      currentUser();
      const s = db();
      const entities = s.entities.map((e) => entitySummary(e.id));
      const active = entities.filter((e) => e.status !== "setup_required");
      const tasksTotal = active.reduce((x, e) => x + e.tasksTotal, 0);
      const tasksDone = active.reduce((x, e) => x + e.tasksDone, 0);
      return {
        period: DEMO.period,
        today: DEMO.today,
        closeDay: DEMO.closeDay,
        entities,
        rollup: {
          tasksTotal,
          tasksDone,
          tasksOverdue: active.reduce((x, e) => x + e.tasksOverdue, 0),
          pctComplete: tasksTotal ? Math.round((tasksDone / tasksTotal) * 1000) / 10 : 0,
          locked: entities.filter((e) => e.periodStatus === "locked").length,
          entities: entities.length,
        },
        forecast: forecastFor(s.entities.map((e) => e.id)),
        consolidationStatus: s.consolidation.status,
      };
    }),
  ),

  // ---- period detail (OV-1..OV-5, lock gates)
  http.get(
    `${API}/entities/:id/periods/:period`,
    route(({ params }): PeriodDetail => {
      currentUser();
      const s = db();
      const e = s.entities.find((x) => x.id === params.id);
      if (!e) fail(404, "Entity not found");
      const p = periodOf(params.id);
      const tasks = s.tasks.filter((t) => t.entityId === params.id);
      const done = tasks.filter((t) => t.status === "completed");
      const overdue = tasks.filter((t) => t.status !== "completed" && t.dueDay < DEMO.closeDay);
      const projected = projection(params.id);
      const total = tasks.length;
      const burndown: PeriodDetail["burndown"] = [];
      const lastDay = Math.max(Math.ceil(projected), p.targetCloseDay, DEMO.closeDay) + 1;
      for (let d = 0; d <= lastDay; d++) {
        const plan = Math.max(0, Math.round((total - (total / p.targetCloseDay) * d) * 10) / 10);
        const actual = d <= DEMO.closeDay ? total - done.filter((t) => (t.completedDay ?? 99) <= d).length : null;
        const remainingNow = total - done.length;
        const projectedV = d >= DEMO.closeDay ? Math.max(0, Math.round((remainingNow - (remainingNow / Math.max(projected - DEMO.closeDay, 0.1)) * (d - DEMO.closeDay)) * 10) / 10) : null;
        burndown.push({ day: d, plan, actual, projected: projectedV });
      }
      const vars = variancesFor(params.id).filter((v) => v.isFlagged);
      const signed = vars.filter((v) => v.status === "signed_off" || v.status === "exception").length;
      const accr = s.accruals.filter((a) => a.entityId === params.id);
      const contracts = s.contracts.filter((c) => c.entityId === params.id);
      const decided = contracts.filter((c) => c.decision || (c.column === "auto_applied" && c.batchSignedOff)).length;
      const insights: PeriodDetail["insights"] = [];
      const nm = vars.filter((v) => v.status === "needs_manual");
      if (nm.length) insights.push({ id: "i1", severity: "critical", text: `${nm.length} flagged line(s) have no usable AI explanation and need a manual one (e.g. ${nm[0].accountCode} ${nm[0].accountName}).`, link: `/e/${params.id}/flux?variance=${nm[0].id}`, citations: [] });
      const rec = vars.find((v) => v.accountName === "Recurring Revenue");
      if (rec) insights.push({ id: "i2", severity: "warning", text: `Recurring Revenue is ${Math.abs(rec.deltaPct ?? 0)}% below July because the August recognition run is held by the gating queue.`, link: `/e/${params.id}/recognition`, citations: rec.explanation?.citations ?? [] });
      if (overdue.length) insights.push({ id: "i3", severity: "warning", text: `${overdue.length} task(s) are overdue: ${overdue.slice(0, 2).map((t) => t.title).join(", ")}.`, link: `/e/${params.id}/checklist?filter=overdue`, citations: [] });
      if (e!.connection.lastError) insights.push({ id: "i4", severity: "critical", text: `Ledger sync problem: ${e!.connection.lastError}`, link: "/setup?tab=connections", citations: [] });
      const unmapped = lockGates(params.id).find((g) => g.key === "mappings");
      if (unmapped && !unmapped.met) insights.push({ id: "i5", severity: "info", text: unmapped.detail + " The period can't lock until they're mapped.", link: unmapped.link, citations: [] });
      if (!insights.length) insights.push({ id: "i0", severity: "info", text: "Nothing needs attention right now.", link: `/e/${params.id}/overview`, citations: [] });
      return {
        id: p.id,
        entityId: p.entityId,
        period: p.period,
        status: p.status,
        targetCloseDay: p.targetCloseDay,
        targetDate: `2026-09-${String(p.targetCloseDay).padStart(2, "0")}`,
        lockedAt: p.lockedAt,
        lockedBy: p.lockedBy,
        closeDay: DEMO.closeDay,
        health: { tasksTotal: total, tasksDone: done.length, tasksOpen: total - done.length, tasksOverdue: overdue.length, pctComplete: Math.round((done.length / total) * 1000) / 10 },
        gates: lockGates(params.id),
        reopenRequests: p.reopenRequests,
        burndown,
        workload: PHASES.map((ph) => ({ phase: ph, complete: tasks.filter((t) => t.phase === ph && t.status === "completed").length, open: tasks.filter((t) => t.phase === ph && t.status !== "completed").length })),
        modules: [
          { key: "checklist", name: "Checklist", pct: Math.round((done.length / total) * 100), release: "MVP" },
          { key: "flux", name: "Flux & variance", pct: vars.length ? Math.round((signed / vars.length) * 100) : 100, release: "MVP" },
          { key: "accruals", name: "Accrual & prepaid", pct: accr.length ? Math.round((accr.filter((a) => a.status !== "suggested").length / accr.length) * 100) : 100, release: "v1" },
          { key: "recognition", name: "Recognition & compliance", pct: contracts.length ? Math.round((decided / contracts.length) * 100) : 100, release: "v1" },
        ],
        insights,
        forecast: forecastFor([params.id]),
      };
    }),
  ),
  http.post(
    `${API}/entities/:id/periods/:period/lock`,
    route(({ params }) => {
      const user = currentUser();
      requirePerm(user, "period.lock", params.id);
      const p = periodOf(params.id);
      if (p.status === "locked") fail(409, "Already locked");
      const unmet = lockGates(params.id).filter((g) => !g.met);
      if (unmet.length) fail(409, "Lock gates not met", unmet.map((g) => g.detail).join(" "), "gates_unmet");
      p.status = "locked";
      p.lockedAt = new Date().toISOString();
      p.lockedBy = user.id;
      audit("period.locked", "period", p.id, `Aug 2026 locked by ${user.name}`, { entityId: params.id });
      return p;
    }),
  ),
  http.post(
    `${API}/entities/:id/periods/:period/reopen-requests`,
    route(({ params, body }) => {
      const user = currentUser();
      requirePerm(user, "period.lock", params.id);
      const p = periodOf(params.id);
      if (p.status !== "locked") fail(409, "Period is open", "Only a locked period can be reopened.");
      if (String(body.reason ?? "").trim().length < 10) fail(422, "Reason too short", "Explain why the period needs to reopen (at least 10 characters).");
      if (p.reopenRequests.some((r) => r.status === "pending")) fail(409, "Request already pending");
      const r = { id: newId("rr"), reason: String(body.reason).trim(), requestedBy: user.id, requestedAt: new Date().toISOString(), status: "pending" as const, decidedBy: null };
      p.reopenRequests.push(r);
      audit("period.reopen_requested", "period", p.id, `Reopen requested: "${r.reason}"`, { entityId: params.id });
      return r;
    }),
  ),
  http.post(
    `${API}/reopen-requests/:id/:decision`,
    route(({ params }) => {
      const user = currentUser();
      const p = db().periods.find((x) => x.reopenRequests.some((r) => r.id === params.id));
      if (!p) fail(404, "Request not found");
      const r = p!.reopenRequests.find((x) => x.id === params.id)!;
      requirePerm(user, "period.reopen.approve", p!.entityId);
      if (r.status !== "pending") fail(409, "Already decided");
      if (r.requestedBy === user.id) fail(403, "Segregation of duties", "You requested this reopen, so you can't approve it.", "sod_reopen");
      r.status = params.decision === "approve" ? "approved" : "rejected";
      r.decidedBy = user.id;
      if (r.status === "approved") {
        p!.status = "open";
        p!.lockedAt = null;
        p!.lockedBy = null;
        if (db().consolidation.status === "locked") db().consolidation.status = "in_progress";
      }
      audit(`period.reopen_${r.status}`, "period", p!.id, `Reopen ${r.status} by ${user.name}`, { entityId: p!.entityId });
      return r;
    }),
  ),

  // ---- checklist (CL-1..CL-8)
  http.get(
    `${API}/entities/:id/periods/:period/tasks`,
    route(({ params }) => {
      currentUser();
      return db()
        .tasks.filter((t) => t.entityId === params.id)
        .map(toTask);
    }),
  ),
  http.patch(
    `${API}/tasks/:id`,
    route(({ params, body }) => {
      const user = currentUser();
      const t = taskOr404(params.id);
      requirePerm(user, "task.edit", t.entityId);
      assertOpen(t.entityId);
      if (body.version !== undefined && body.version !== t.version) fail(409, "Task changed", "Someone else updated this task. Reload to see their changes.", "stale_version");
      const owner = body.ownerId ?? t.ownerId;
      const reviewer = body.reviewerId ?? t.reviewerId;
      if (owner && reviewer && owner === reviewer) fail(422, "Segregation of duties", "The reviewer must be a different person from the owner (CL-5).", "sod_owner_reviewer");
      const changes: string[] = [];
      if (body.ownerId !== undefined && body.ownerId !== t.ownerId) changes.push(`owner → ${userName(body.ownerId)}`);
      if (body.reviewerId !== undefined && body.reviewerId !== t.reviewerId) changes.push(`reviewer → ${userName(body.reviewerId)}`);
      if (body.dueDay !== undefined && body.dueDay !== t.dueDay) changes.push(`due → D+${body.dueDay}`);
      if (body.status === "in_progress" && t.status === "not_started") changes.push("started");
      Object.assign(t, {
        ownerId: owner,
        reviewerId: reviewer,
        dueDay: body.dueDay ?? t.dueDay,
        status: body.status === "in_progress" && (t.status === "not_started" || t.status === "rejected") ? "in_progress" : t.status,
        version: t.version + 1,
      });
      audit("task.updated", "task", t.id, `${t.title}: ${changes.join(", ") || "updated"}`, { entityId: t.entityId });
      return toTask(t);
    }),
  ),
  http.post(
    `${API}/tasks/:id/subtasks`,
    route(({ params, body }) => {
      const user = currentUser();
      const t = taskOr404(params.id);
      requirePerm(user, "task.edit", t.entityId);
      assertOpen(t.entityId);
      const title = String(body.title ?? "").trim();
      if (!title) fail(422, "Title required");
      t.subtasks.push({ id: newId("st"), title, isDone: false, aiDrafted: false, removed: false });
      t.version += 1;
      audit("subtask.added", "task", t.id, `Subtask added to "${t.title}": ${title}`, { entityId: t.entityId });
      return toTask(t);
    }),
  ),
  http.patch(
    `${API}/subtasks/:id`,
    route(({ params, body }) => {
      const user = currentUser();
      const { task, sub } = findSubtask(params.id);
      requirePerm(user, "task.edit", task.entityId);
      assertOpen(task.entityId);
      if (body.isDone !== undefined) sub.isDone = !!body.isDone;
      if (body.title !== undefined) sub.title = String(body.title).trim() || sub.title;
      if (body.removed) sub.removed = true;
      task.version += 1;
      audit(body.removed ? "subtask.removed" : "subtask.updated", "task", task.id, `Subtask "${sub.title}" ${body.removed ? "removed" : body.isDone !== undefined ? (sub.isDone ? "checked" : "unchecked") : "renamed"}`, { entityId: task.entityId });
      return toTask(task);
    }),
  ),
  http.post(
    `${API}/tasks/:id/evidence`,
    route(({ params, body }) => {
      const user = currentUser();
      const t = taskOr404(params.id);
      requirePerm(user, "task.edit", t.entityId);
      assertOpen(t.entityId);
      const size = Number(body.sizeBytes);
      if (!body.fileName || !(size > 0)) fail(422, "Invalid file");
      if (size > 100 * 1024 * 1024) fail(413, "File too large", "Evidence files can be up to 100 MB.");
      const ev = { id: newId("ev"), fileName: String(body.fileName), sizeBytes: size, contentType: String(body.contentType || "application/octet-stream"), scanStatus: "clean" as const, uploadedBy: user.id, uploadedAt: new Date().toISOString() };
      t.evidence.push(ev);
      t.version += 1;
      audit("evidence.uploaded", "task", t.id, `Evidence "${ev.fileName}" attached to "${t.title}" (malware scan: clean)`, { entityId: t.entityId });
      return { uploadUrl: `https://s3.example/cch-evidence/${db().tenant.id}/${ev.id}?X-Amz-Signature=…`, task: toTask(t) };
    }),
  ),
  http.post(
    `${API}/tasks/:id/:action`,
    route(({ params, body }) => {
      const user = currentUser();
      const t = taskOr404(params.id);
      assertOpen(t.entityId);
      const deps = db().tasks.filter((x) => t.dependsOn.includes(x.id) && x.status !== "completed");
      switch (params.action) {
        case "submit": {
          requirePerm(user, "task.edit", t.entityId);
          if (!["in_progress", "not_started", "rejected"].includes(t.status)) fail(409, "Can't submit", `Task is ${t.status.replace("_", " ")}.`);
          if (deps.length) fail(409, "Blocked by dependencies", `Complete first: ${deps.map((d) => d.title).join(", ")}.`, "dependencies");
          if (t.requiresEvidence && t.evidence.length === 0) fail(422, "Evidence required", "Reconciliation tasks need an attached workpaper before sign-off (CL-8).", "evidence_required");
          t.status = "submitted";
          t.submittedBy = user.id;
          audit("task.submitted", "task", t.id, `"${t.title}" submitted for sign-off`, { entityId: t.entityId });
          break;
        }
        case "sign-off": {
          requirePerm(user, "task.signoff", t.entityId);
          if (t.status !== "submitted") fail(409, "Not awaiting sign-off");
          if (t.submittedBy === user.id || t.ownerId === user.id) fail(403, "Segregation of duties", "You prepared this task, so a different reviewer must sign it off (CL-5).", "sod_signoff");
          t.status = "completed";
          t.signedOffBy = user.id;
          t.completedDay = DEMO.closeDay;
          audit("task.signed_off", "task", t.id, `"${t.title}" signed off`, { entityId: t.entityId });
          break;
        }
        case "reject": {
          requirePerm(user, "task.signoff", t.entityId);
          if (t.status !== "submitted") fail(409, "Not awaiting sign-off");
          if (String(body.reason ?? "").trim().length < 3) fail(422, "Reason required");
          t.status = "rejected";
          audit("task.rejected", "task", t.id, `"${t.title}" sent back: ${body.reason}`, { entityId: t.entityId });
          addComment("task", t.id, user.id, `Sent back: ${body.reason}`);
          break;
        }
        case "reject-ai-verification": {
          requirePerm(user, "task.signoff", t.entityId);
          if (!t.verifiedByAi) fail(409, "Not AI-verified");
          if (String(body.reason ?? "").trim().length < 3) fail(422, "Reason required");
          t.verifiedByAi = false;
          t.status = "in_progress";
          t.signedOffBy = null;
          t.completedDay = null;
          audit("task.ai_verification_rejected", "task", t.id, `AI verification of "${t.title}" rejected: ${body.reason}`, { entityId: t.entityId });
          addComment("task", t.id, user.id, `AI verification rejected: ${body.reason}`);
          break;
        }
        default:
          fail(404, "Unknown action");
      }
      t.version += 1;
      return toTask(t);
    }),
  ),

  // ---- comments (append-only)
  http.get(
    `${API}/comments`,
    route(({ url }) =>
      db()
        .comments.filter((c) => c.subjectType === url.searchParams.get("subjectType") && c.subjectId === url.searchParams.get("subjectId"))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    ),
  ),
  http.post(
    `${API}/comments`,
    route(({ body }) => {
      const user = currentUser();
      if (!can(user, "task.edit") && !can(user, "task.signoff") && !can(user, "je.approve") && !can(user, "context.propose")) fail(403, "Read-only role", "Auditors can't comment.");
      const text = String(body.body ?? "").trim();
      if (!text || text.length > 10000) fail(422, "Comment must be 1–10,000 characters");
      return addComment(body.subjectType, body.subjectId, user.id, text);
    }),
  ),
];

function addComment(subjectType: Comment["subjectType"], subjectId: string, authorId: string, body: string) {
  const c: Comment = { id: newId("cm"), subjectType, subjectId, authorId, body, createdAt: new Date().toISOString() };
  db().comments.push(c);
  audit("comment.added", subjectType, subjectId, `Comment: ${body.slice(0, 80)}`);
  return c;
}
