/**
 * API contract types. These mirror ARCHITECTURE.md §5 and DATABASE.md.
 * When the FastAPI backend exists, this file is replaced by the client
 * generated from its OpenAPI spec (TECH-STACK §7).
 */

export type ID = string;
export type ISODate = string; // 2026-09-04
export type ISODateTime = string;
export type PeriodKey = string; // "2026-08"
export type Currency = string; // ISO 4217

// ---------------------------------------------------------------- identity
export type Role = "preparer" | "reviewer" | "approver" | "controller" | "admin" | "auditor";

export interface Membership {
  id: ID;
  entityId: ID | null; // null = all entities
  role: Role;
}

export interface User {
  id: ID;
  name: string;
  email: string;
  title: string;
  status: "invited" | "active" | "deactivated";
  memberships: Membership[];
}

export interface Me {
  user: User;
  tenant: { id: ID; name: string; reportingCurrency: Currency };
  /** Effective permissions per entity id ("*" = tenant-wide). */
  permissions: Record<string, Permission[]>;
  authTime: ISODateTime;
}

export type Permission =
  | "view"
  | "task.edit"
  | "task.signoff"
  | "context.propose"
  | "context.approve.account"
  | "context.approve.broad"
  | "je.prepare"
  | "je.approve"
  | "period.lock"
  | "period.reopen.approve"
  | "setup.manage"
  | "thresholds.manage"
  | "audit.view"
  | "recognition.decide"
  | "recognition.policy"
  | "consolidation.manage";

// ---------------------------------------------------------------- errors
/** RFC 9457 problem details. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code?: string;
  requestId?: string;
}

// ---------------------------------------------------------------- entities & brain
export type ErpType = "netsuite" | "sap";

export interface Connection {
  status: "pending" | "connected" | "error" | "disabled";
  lastSyncAt: ISODateTime | null;
  lastError: string | null;
  secretRef: string | null; // masked reference, never the secret
}

export interface Entity {
  id: ID;
  name: string;
  region: string;
  erpType: ErpType;
  functionalCurrency: Currency;
  status: "setup_required" | "active";
  ownershipPct: number;
  parentId: ID | null;
  connection: Connection;
}

export interface SyncRun {
  id: ID;
  entityId: ID;
  trigger: "schedule" | "manual" | "backfill";
  status: "running" | "succeeded" | "partial" | "failed";
  startedAt: ISODateTime;
  finishedAt: ISODateTime | null;
  stats: { accounts: number; lines: number };
  error?: string;
}

export interface StandardAccount {
  id: ID;
  code: string;
  name: string;
  accountClass: AccountClass;
}

export type AccountClass = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface AccountMapping {
  accountId: ID;
  entityId: ID;
  erpCode: string;
  name: string;
  accountClass: AccountClass;
  stdAccountId: ID | null;
  balance: number;
}

export interface Source {
  id: ID;
  category: string;
  name: string;
  details: string;
  status: "connected" | "available";
  release: "MVP" | "v1" | "Later";
}

// ---------------------------------------------------------------- close
export type CloseStatus = "on_track" | "needs_review" | "at_risk" | "setup_required";

export interface EntityCloseSummary {
  entityId: ID;
  entityName: string;
  region: string;
  erpType: ErpType;
  period: PeriodKey;
  status: CloseStatus;
  periodStatus: "open" | "locked";
  tasksTotal: number;
  tasksDone: number;
  tasksOverdue: number;
  pctComplete: number;
  targetCloseDay: number;
  projectedCloseDay: number | null;
  lastSyncAt: ISODateTime | null;
}

export interface CloseSummary {
  period: PeriodKey;
  today: ISODate;
  closeDay: number; // D+n today
  entities: EntityCloseSummary[];
  rollup: { tasksTotal: number; tasksDone: number; tasksOverdue: number; pctComplete: number; locked: number; entities: number };
  forecast: Forecast; // v1 (HUB-3)
  consolidationStatus: "not_started" | "in_progress" | "locked"; // v1 (HUB-5)
}

export interface Forecast {
  projectedCloseDay: number;
  planCloseDay: number;
  varianceDays: number;
  drags: { label: string; detail: string; link: string }[];
}

export interface PeriodDetail {
  id: ID;
  entityId: ID;
  period: PeriodKey;
  status: "open" | "locked";
  targetCloseDay: number;
  targetDate: ISODate;
  lockedAt: ISODateTime | null;
  lockedBy: ID | null;
  closeDay: number;
  health: {
    tasksTotal: number;
    tasksDone: number;
    tasksOpen: number;
    tasksOverdue: number;
    pctComplete: number;
  };
  gates: LockGate[];
  reopenRequests: ReopenRequest[];
  burndown: { day: number; plan: number; actual: number | null; projected: number | null }[];
  workload: { phase: Phase; complete: number; open: number }[];
  modules: { key: string; name: string; pct: number; release: "MVP" | "v1" }[];
  insights: { id: ID; severity: "info" | "warning" | "critical"; text: string; link: string; citations: Citation[] }[];
  forecast: Forecast;
}

export interface LockGate {
  key: "tasks" | "variances" | "mappings";
  label: string;
  met: boolean;
  detail: string;
  link: string;
}

export interface ReopenRequest {
  id: ID;
  reason: string;
  requestedBy: ID;
  requestedAt: ISODateTime;
  status: "pending" | "approved" | "rejected";
  decidedBy: ID | null;
}

// ---------------------------------------------------------------- checklist
export type Phase = "pre_close" | "reconciliations" | "accruals" | "intercompany" | "compliance" | "board_pack";
export type TaskStatus = "not_started" | "in_progress" | "submitted" | "completed" | "rejected";

export interface Subtask {
  id: ID;
  title: string;
  isDone: boolean;
  aiDrafted: boolean;
  removed: boolean;
}

export interface Evidence {
  id: ID;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  scanStatus: "pending" | "clean" | "infected";
  uploadedBy: ID;
  uploadedAt: ISODateTime;
}

export interface Task {
  id: ID;
  entityId: ID;
  periodId: ID;
  phase: Phase;
  title: string;
  description: string;
  ownerId: ID | null;
  reviewerId: ID | null;
  dueDay: number;
  status: TaskStatus;
  requiresEvidence: boolean;
  isReconciliation: boolean;
  verifiedByAi: boolean;
  aiVerification: AiOutput | null;
  subtasks: Subtask[];
  evidence: Evidence[];
  submittedBy: ID | null;
  signedOffBy: ID | null;
  dependsOn: ID[];
  version: number;
  overdue: boolean;
}

export interface Comment {
  id: ID;
  subjectType: "task" | "variance" | "je_draft" | "context_note";
  subjectId: ID;
  authorId: ID;
  body: string;
  createdAt: ISODateTime;
}

// ---------------------------------------------------------------- AI
export interface Citation {
  recordType: "gl_line" | "account" | "contract" | "task" | "variance" | "context_note" | "je_draft" | "sync_run" | "accrual" | "ic_match";
  recordId: ID;
  label: string;
  link?: string;
}

export interface AiOutput {
  id: ID;
  kind: "variance_explanation" | "context_preview" | "je_draft" | "task_verification" | "subtask_draft" | "copilot_answer" | "accrual_detection" | "recognition_recommendation" | "ic_mismatch";
  outcome: "ok" | "insufficient_data" | "refused" | "failed";
  modelId: string;
  promptVersion: string;
  text: string;
  citations: Citation[];
  confidence: number | null;
  inferenceRegion: string;
  createdAt: ISODateTime;
  dataAsOf: ISODateTime | null;
  contextNoteIds: ID[];
}

// ---------------------------------------------------------------- flux
export type VarianceStatus = "not_flagged" | "open" | "needs_manual" | "explained" | "signed_off" | "exception";

export interface Variance {
  id: ID;
  entityId: ID;
  accountId: ID;
  accountCode: string;
  accountName: string;
  accountClass: AccountClass;
  parentAccountId: ID | null;
  isGroup: boolean;
  depth: number;
  currency: Currency;
  prior: number;
  current: number;
  delta: number;
  deltaPct: number | null;
  isFlagged: boolean;
  thresholdVersion: number;
  status: VarianceStatus;
  explanation: AiOutput | null;
  attributions: { accountId: ID; accountCode: string; accountName: string; amount: number; sharePct: number }[];
  signedOffBy: ID | null;
  exceptionReason: string | null;
  changedAfterSignoff: boolean;
  draftIds: ID[];
  version: number;
}

export interface FluxView {
  period: PeriodKey;
  priorPeriod: PeriodKey;
  threshold: Threshold;
  variances: Variance[];
  counts: { flagged: number; total: number; signedOff: number };
}

export interface Threshold {
  id: ID;
  entityId: ID;
  accountClass: AccountClass | null;
  absAmount: number;
  pct: number;
  version: number;
  effectiveFrom: PeriodKey;
  createdBy: ID;
  createdAt: ISODateTime;
}

export interface ContextNote {
  id: ID;
  scope: "account" | "account_group" | "cross_entity";
  entityId: ID | null;
  accountId: ID | null;
  accountLabel: string;
  text: string;
  status: "pending" | "approved" | "rejected" | "retired";
  proposedBy: ID;
  proposedAt: ISODateTime;
  decidedBy: ID | null;
  decidedAt: ISODateTime | null;
  reviewBy: ISODate | null;
  changesMaterialConclusion: boolean;
  version: number;
  appliedToVarianceIds: ID[];
  previewExplanation: string | null;
  decisionReason?: string | null;
  retiredBy?: ID | null;
}

// ---------------------------------------------------------------- journals
export type JeStatus = "draft" | "submitted" | "approved" | "rejected" | "posting" | "posted" | "post_failed" | "withdrawn";

export interface JeLine {
  id: ID;
  lineNo: number;
  accountId: ID;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo: string;
}

export interface Approval {
  id: ID;
  level: 1 | 2;
  approverId: ID;
  decision: "approved" | "rejected";
  draftVersion: number;
  comment: string | null;
  decidedAt: ISODateTime;
  batchId: ID | null;
}

export interface PostingAttempt {
  attemptNo: number;
  status: "pending" | "succeeded" | "failed" | "unknown";
  erpDocNumber: string | null;
  error: string | null;
  at: ISODateTime;
}

export interface JeDraft {
  id: ID;
  number: string;
  entityId: ID;
  periodId: ID;
  type: "correction" | "reclass" | "accrual";
  sourceType: "variance" | "manual" | "accrual_proposal" | "contract" | "ic_true_up";
  sourceId: ID | null;
  sourceLabel: string | null;
  description: string;
  status: JeStatus;
  createdByAi: boolean;
  aiOutput: AiOutput | null;
  preparerId: ID | null;
  currency: Currency;
  lines: JeLine[];
  totalDebit: number;
  totalCredit: number;
  requiresSecondApproval: boolean;
  version: number;
  approvals: Approval[];
  postingAttempts: PostingAttempt[];
  erpDocNumber: string | null;
  sourceChanged: boolean;
  createdAt: ISODateTime;
}

export interface JeList {
  drafts: JeDraft[];
  summary: { count: number; total: number; byStatus: Record<JeStatus, { count: number; total: number }> };
  policy: ApprovalPolicy;
}

export interface ApprovalPolicy {
  id: ID;
  entityId: ID;
  secondApprovalAbove: number;
  currency: Currency;
  version: number;
  effectiveFrom: PeriodKey;
}

// ---------------------------------------------------------------- jobs
export interface Job {
  id: ID;
  kind: "sync" | "backfill" | "generate_drafts" | "post_batch" | "audit_export" | "explain" | "recognition_run" | "translation_run";
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number; // 0..100
  message: string;
  result?: Record<string, unknown>;
  createdAt: ISODateTime;
}

// ---------------------------------------------------------------- audit
export interface AuditEvent {
  id: number;
  occurredAt: ISODateTime;
  actorType: "user" | "ai" | "system";
  actorId: ID | null;
  action: string;
  subjectType: string;
  subjectId: ID;
  entityId: ID | null;
  summary: string;
  requestId: string;
  prevHash: string | null;
  hash: string;
}

export interface TraceNode {
  kind: "posting" | "approval" | "draft" | "ai_output" | "variance" | "gl_line" | "context_note" | "sync_run";
  id: ID;
  title: string;
  detail: string;
  at: ISODateTime | null;
  actor: string | null;
}

// ---------------------------------------------------------------- v1: accruals
export interface AccrualProposal {
  id: ID;
  entityId: ID;
  vendor: string;
  category: string;
  basis: "run_rate" | "contract" | "open_po";
  amount: number;
  currency: Currency;
  evidence: string;
  status: "suggested" | "approved" | "dismissed";
  dismissReason: string | null;
  draftId: ID | null;
  ai: AiOutput;
}

export interface AccrualsView {
  kpis: { categorySpend: number; runRate: number; accruedLiabilities: number; prepaidAssets: number; needsAccrual: number; suggestedTotal: number };
  categories: { category: string; actual: number; runRate: number }[];
  proposals: AccrualProposal[];
  currency: Currency;
}

// ---------------------------------------------------------------- v1: recognition
export type GatingColumn = "needs_review" | "auto_applied" | "started" | "deferred";

export interface PolicyCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface Contract {
  id: ID;
  entityId: ID;
  customer: string;
  code: string;
  arr: number;
  monthly: number;
  currency: Currency;
  owner: string;
  scheduleVersion: string;
  trigger: string;
  evidence: string[];
  evidenceFound: boolean;
  modifiedThisPeriod: boolean;
  confidence: number;
  column: GatingColumn;
  recommendation: { action: "start" | "defer"; label: string; rationale: string };
  policyChecks: PolicyCheck[];
  decision: { action: "start" | "defer" | "pulled_back"; justification: string | null; by: ID; at: ISODateTime } | null;
  batchSignedOff: boolean;
}

export interface AutoApplyPolicy {
  entityId: ID;
  enabled: boolean;
  version: number;
  maxPerItem: number;
  maxPctOfRevenue: number;
  minConfidence: number;
  historyPeriods: number;
  aggregateCap: number;
  pendingChange: (Omit<AutoApplyPolicy, "pendingChange" | "sampling" | "entityId"> & { proposedBy: ID; approvals: ID[] }) | null;
  sampling: { sampleSize: number; checked: number; errors: number; errorRatePct: number };
}

export interface RecognitionView {
  monthly: { month: string; planned: number; recognised: number }[];
  kpis: { contractedArr: number; deviations: number; complianceRead: number; complianceTotal: number; monthlyRevenue: number; autoAppliedTotal: number };
  contracts: Contract[];
  policy: AutoApplyPolicy;
}

// ---------------------------------------------------------------- v1: copilot
export interface CopilotAnswer {
  text: string;
  citations: Citation[];
  outcome: AiOutput["outcome"];
}

// ---------------------------------------------------------------- v1: consolidation
export interface FxRate {
  ccy: Currency;
  closing: number;
  average: number;
  source: string;
}

export interface TranslationRow {
  entityId: ID;
  entityName: string;
  ccy: Currency;
  assets: number;
  liabilities: number;
  equity: number;
  netIncome: number;
  assetsUsd: number;
  liabilitiesUsd: number;
  equityUsd: number;
  netIncomeUsd: number;
  cta: number;
}

export interface IcMatch {
  id: ID;
  fromEntityId: ID;
  toEntityId: ID;
  kind: "receivable_payable" | "revenue_expense";
  fromAmountUsd: number;
  toAmountUsd: number;
  difference: number;
  tolerance: number;
  status: "matched" | "mismatch" | "pending_counterparty" | "resolved";
  likelyCause: "fx" | "timing" | "amount" | null;
  explanation: string;
  trueUpDraftId: ID | null;
}

export interface Elimination {
  id: ID;
  description: string;
  icMatchId: ID;
  amount: number;
  status: "proposed" | "approved" | "posted";
  preparedBy: ID | null;
  approvedBy: ID | null;
}

export interface ConsolidatedLine {
  code: string;
  name: string;
  statement: "pl" | "bs";
  byEntity: Record<ID, number>;
  eliminations: number;
  consolidated: number;
}

export interface ConsolidationView {
  period: PeriodKey;
  status: "not_started" | "in_progress" | "locked";
  tolerance: { absUsd: number; pct: number };
  steps: { key: string; label: string; done: boolean; detail: string }[];
  rates: FxRate[];
  translation: TranslationRow[];
  matches: IcMatch[];
  eliminations: Elimination[];
  statements: ConsolidatedLine[];
  entityIds: ID[];
}

// ---------------------------------------------------------------- notifications (v1, CL-6)
export interface Notification {
  id: ID;
  kind: "overdue_task" | "approval_needed" | "context_review" | "sync_failed" | "signoff_needed";
  text: string;
  link: string;
  createdAt: ISODateTime;
}
