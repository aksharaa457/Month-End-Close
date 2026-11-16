import type { Contract, GatingColumn } from "@/shared/api/types";

export const recKey = (entityId: string) => ["recognition", entityId] as const;

export const columnMeta: Record<GatingColumn, { label: string; hint: string }> = {
  needs_review: { label: "Needs review", hint: "Decide one by one" },
  auto_applied: { label: "Auto-applied", hint: "Pre-approved by policy, awaiting batch sign-off" },
  started: { label: "Started", hint: "Recognition starts in Aug" },
  deferred: { label: "Deferred", hint: "Moved to Sep" },
};

export const COLUMNS: GatingColumn[] = ["needs_review", "auto_applied", "started", "deferred"];

export const JUSTIFICATION_MIN = 10;

/** RR-6: deferrals and overrides of the AI recommendation need a written justification. */
export function needsJustification(c: Contract, action: "start" | "defer") {
  return action === "defer" || action !== c.recommendation.action;
}

export function checksPassed(c: Contract) {
  return c.policyChecks.filter((x) => x.passed).length;
}
