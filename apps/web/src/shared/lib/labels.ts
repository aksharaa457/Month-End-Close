import type { CloseStatus, JeStatus, Phase, Role, TaskStatus, VarianceStatus } from "@/shared/api/types";

export const PHASES: Phase[] = ["pre_close", "reconciliations", "accruals", "intercompany", "compliance", "board_pack"];

export const phaseLabel: Record<Phase, string> = {
  pre_close: "Pre-close",
  reconciliations: "Reconciliations",
  accruals: "Accruals",
  intercompany: "Intercompany",
  compliance: "Compliance",
  board_pack: "Board pack",
};

export const roleLabel: Record<Role, string> = {
  preparer: "Preparer",
  reviewer: "Reviewer",
  approver: "Approver",
  controller: "Controller",
  admin: "Admin",
  auditor: "Auditor",
};

type Tone = "default" | "success" | "warning" | "destructive" | "info" | "ai" | "outline";

export const closeStatusMeta: Record<CloseStatus, { label: string; tone: Tone }> = {
  on_track: { label: "On track", tone: "success" },
  needs_review: { label: "Needs review", tone: "warning" },
  at_risk: { label: "At risk", tone: "destructive" },
  setup_required: { label: "Set up required", tone: "outline" },
};

export const taskStatusMeta: Record<TaskStatus, { label: string; tone: Tone }> = {
  not_started: { label: "Not started", tone: "outline" },
  in_progress: { label: "In progress", tone: "info" },
  submitted: { label: "Awaiting sign-off", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  rejected: { label: "Rejected", tone: "destructive" },
};

export const varianceStatusMeta: Record<VarianceStatus, { label: string; tone: Tone }> = {
  not_flagged: { label: "Within threshold", tone: "outline" },
  open: { label: "Open", tone: "warning" },
  needs_manual: { label: "Needs manual explanation", tone: "destructive" },
  explained: { label: "Explained", tone: "info" },
  signed_off: { label: "Signed off", tone: "success" },
  exception: { label: "Approved exception", tone: "success" },
};

export const jeStatusMeta: Record<JeStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "outline" },
  submitted: { label: "Awaiting approval", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  rejected: { label: "Rejected", tone: "destructive" },
  posting: { label: "Posting…", tone: "info" },
  posted: { label: "Posted", tone: "success" },
  post_failed: { label: "Approved, not posted", tone: "destructive" },
  withdrawn: { label: "Withdrawn", tone: "outline" },
};
