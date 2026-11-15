import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Archive, Check, Clock, Eye, MessageSquare, ShieldCheck, Sparkles, X } from "lucide-react";
import { api } from "@/shared/api/client";
import { qk, useAction, useCan, useEntities, useMe, useUserName } from "@/shared/api/hooks";
import type { ContextNote } from "@/shared/api/types";
import { dateLabel, dateTimeLabel } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Label, Select, Textarea } from "@/shared/ui/input";
import { EmptyState, Skeleton } from "@/shared/ui/misc";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { PageHeader } from "@/shared/ui/domain";

type StatusFilter = ContextNote["status"] | "all";
type Tone = "default" | "success" | "warning" | "destructive" | "info" | "ai" | "outline";

const STATUSES: { value: StatusFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "retired", label: "Retired" },
  { value: "all", label: "All" },
];
const statusMeta: Record<ContextNote["status"], { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "destructive" },
  retired: { label: "Retired", tone: "outline" },
};
const scopeLabel: Record<ContextNote["scope"], string> = { account: "One account", account_group: "Account group", cross_entity: "Cross-entity" };

/** Review-due cutoff: within 60 days of the 2026-09-04 review date, or already past. */
const REVIEW_REF = Date.UTC(2026, 8, 4);
const REVIEW_DUE_CUTOFF = REVIEW_REF + 60 * 86_400_000;
const reviewDue = (d: string | null) => !!d && new Date(d).getTime() <= REVIEW_DUE_CUTOFF;

/** Broad notes need a Controller (§10.2); narrow ones an account owner/reviewer. */
const needsController = (n: ContextNote) => n.scope !== "account" || n.changesMaterialConclusion || n.reviewBy === null;

const TIERS = [
  { who: "Any preparer", what: "Proposes context. It stays pending (preview only)." },
  { who: "Account owner / reviewer", what: "Approves context for one account in one entity, with an expiry, that doesn't change a material conclusion." },
  { who: "Controller", what: "Approves cross-entity or account-group context, anything that changes a material conclusion, or context with no expiry." },
  { who: "Policy owner", what: "Reviews active context every quarter and retires anything stale." },
];

/** AI context management (FX-5, FX-6, PRD §10.2). */
export default function ContextNotesPage() {
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [entityId, setEntityId] = useState("");
  const { data: entities } = useEntities();
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (entityId) params.set("entityId", entityId);
  const { data: notes, isLoading, isError } = useQuery({
    queryKey: [...qk.contextNotes, status, entityId],
    queryFn: () => api.get<ContextNote[]>(`/context-notes${params.toString() ? `?${params}` : ""}`),
  });
  const entityName = (id: string | null) => (id ? entities?.find((e) => e.id === id)?.name ?? id : "All entities");

  return (
    <div className="min-w-0">
      <PageHeader title="AI context" description="Approved business rules that change how the AI evaluates a line in future periods." />

      <Card className="mb-5 grid gap-4 p-4 md:grid-cols-2">
        <div className="space-y-3 text-sm">
          <div className="flex gap-2">
            <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p>
              <strong>A comment</strong> is a note for a colleague. The AI doesn&apos;t act on it.
            </p>
          </div>
          <div className="flex gap-2">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-ai" aria-hidden />
            <p>
              <strong>AI context</strong> is an approved, versioned business rule. Once approved, it changes how the AI explains that line from now on, and every explanation lists the context it used.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">Whoever proposed a note can&apos;t approve it. Each note has a review-by date (12 months by default).</p>
        </div>
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Who approves what (§10.2)</h2>
          <dl className="space-y-1.5 text-xs">
            {TIERS.map((t) => (
              <div key={t.who} className="grid grid-cols-[8.5rem_1fr] gap-2">
                <dt className="font-medium">{t.who}</dt>
                <dd className="text-muted-foreground">{t.what}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <TabsList aria-label="Filter by status">
            {STATUSES.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="grid w-full gap-1 sm:w-56">
          <Label htmlFor="ctx-entity">Entity</Label>
          <Select id="ctx-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">All entities</option>
            {entities?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : isError ? (
        <EmptyState title="Couldn't load AI context" description="Try again in a moment." />
      ) : !notes?.length ? (
        <EmptyState title={status === "all" ? "No AI context yet" : `No ${status} context`} description="Context is proposed from a variance line in flux review." />
      ) : (
        <ul className="space-y-3">
          {notes.map((n) => (
            <li key={n.id}>
              <NoteCard note={n} entityName={entityName} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteCard({ note: n, entityName }: { note: ContextNote; entityName: (id: string | null) => string }) {
  const { data: me } = useMe();
  const can = useCan();
  const userName = useUserName();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");

  const invalidate = [qk.contextNotes, ["flux"]];
  const approve = useAction(() => api.post<ContextNote>(`/context-notes/${n.id}/approve`, {}), { invalidate, success: "Context approved. It now applies to future explanations." });
  const reject = useAction((r: string) => api.post<ContextNote>(`/context-notes/${n.id}/reject`, { reason: r }), {
    invalidate,
    success: "Context rejected",
    onSuccess: () => setRejectOpen(false),
  });
  const retire = useAction(() => api.post<ContextNote>(`/context-notes/${n.id}/retire`, {}), { invalidate, success: "Context retired" });
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState(n.text);
  const [editReview, setEditReview] = useState(n.reviewBy ?? "");
  const edit = useAction(() => api.patch<ContextNote>(`/context-notes/${n.id}`, { text: editText, reviewBy: editReview || null, version: n.version }), {
    invalidate,
    success: "New version saved. It needs approval before it applies.",
    onSuccess: () => setEditOpen(false),
  });
  const canEdit = can("context.propose", n.entityId) && (n.status === "pending" || n.status === "approved");

  const broad = needsController(n);
  const canDecide = broad ? can("context.approve.broad", n.entityId) : can("context.approve.account", n.entityId) || can("context.approve.broad", n.entityId);
  const canRetire = can("context.approve.broad", n.entityId) || can("context.approve.account", n.entityId);
  const isProposer = !!me && me.user.id === n.proposedBy;
  const due = (n.status === "approved" || n.status === "pending") && reviewDue(n.reviewBy);
  const fluxLink = n.entityId && n.accountId ? `/e/${n.entityId}/flux?variance=${n.accountId}` : null;
  const busy = approve.isPending || reject.isPending;

  return (
    <Card className={cn("p-4", n.status === "pending" && "border-warning/40")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {fluxLink ? (
              <Link to={fluxLink} className="font-semibold hover:underline">
                {n.accountLabel}
              </Link>
            ) : (
              <span className="font-semibold">{n.accountLabel}</span>
            )}
            <Badge variant="outline">{scopeLabel[n.scope]}</Badge>
            <Badge variant={statusMeta[n.status].tone}>{statusMeta[n.status].label}</Badge>
            <span className="text-xs text-muted-foreground">v{n.version}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{entityName(n.entityId)}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {n.changesMaterialConclusion ? (
            <Badge variant="destructive">
              <AlertTriangle className="size-3" aria-hidden /> Changes a material conclusion
            </Badge>
          ) : null}
          {due ? (
            <Badge variant="warning">
              <Clock className="size-3" aria-hidden /> Review due
            </Badge>
          ) : null}
        </div>
      </div>

      <blockquote className="mt-3 border-l-2 border-ai/50 pl-3 text-sm leading-relaxed">{n.text}</blockquote>

      <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Proposed</dt>
          <dd>
            {userName(n.proposedBy)} · {dateTimeLabel(n.proposedAt)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Decided</dt>
          <dd>
            {n.decidedAt ? `${n.decidedBy ? userName(n.decidedBy) : "—"} · ${dateTimeLabel(n.decidedAt)}` : "—"}
            {n.retiredBy ? <span className="block text-muted-foreground">Retired by {userName(n.retiredBy)}</span> : null}
            {n.decisionReason ? <span className="block text-muted-foreground">"{n.decisionReason}"</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Review by</dt>
          <dd className={cn(due && "font-medium text-warning")}>{n.reviewBy ? dateLabel(n.reviewBy) : "No expiry"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Applied to</dt>
          <dd>{n.appliedToVarianceIds.length ? `${n.appliedToVarianceIds.length} variance line(s)` : "Not yet applied"}</dd>
        </div>
      </dl>

      {n.status === "pending" && n.previewExplanation ? (
        <div className="mt-3 rounded-lg border border-dashed border-ai/40 bg-ai-soft/40 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ai">
            <Eye className="size-3.5" aria-hidden /> Preview — not applied until approved
          </div>
          <p className="whitespace-pre-line text-sm leading-relaxed">{n.previewExplanation}</p>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
          {n.status === "pending"
            ? broad
              ? "Needs a Controller to approve (broad scope, material, or no expiry)."
              : "An account owner/reviewer or a Controller can approve."
            : n.status === "approved"
              ? "Active. Applies to future explanations on this line."
              : n.status === "retired"
                ? "Retired. No longer applied."
                : "Rejected. Never applied."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {fluxLink ? (
            <Button asChild variant="link" size="sm">
              <Link to={fluxLink}>Open flux line</Link>
            </Button>
          ) : null}
          {n.status === "pending" ? (
            <>
              <Button size="sm" variant="outline" disabled={isProposer || !canDecide || busy} loading={reject.isPending} onClick={() => { setReason(""); setRejectOpen(true); }}>
                <X /> Reject
              </Button>
              <Button size="sm" variant="success" disabled={isProposer || !canDecide || busy} loading={approve.isPending} onClick={() => approve.mutate(undefined)}>
                <Check /> Approve
              </Button>
            </>
          ) : null}
          {canEdit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditText(n.text);
                setEditReview(n.reviewBy ?? "");
                setEditOpen(true);
              }}
            >
              Edit
            </Button>
          ) : null}
          {n.status === "approved" && canRetire ? (
            <Button size="sm" variant="outline" loading={retire.isPending} onClick={() => retire.mutate(undefined)}>
              <Archive /> Retire
            </Button>
          ) : null}
        </div>
      </div>
      {n.status === "pending" && isProposer ? (
        <p className="mt-2 text-xs text-warning">You proposed this context, so someone else must approve or reject it (segregation of duties).</p>
      ) : n.status === "pending" && !canDecide ? (
        <p className="mt-2 text-xs text-muted-foreground">You don&apos;t have the approval rights this note needs.</p>
      ) : null}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit AI context (new version v{n.version + 1})</DialogTitle>
            <DialogDescription>
              Editing creates a new version that goes back to pending.{n.status === "approved" ? " The current version stops applying until the new one is approved." : ""} You become its proposer, so someone else must approve it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`edit-${n.id}`}>Context</Label>
            <Textarea id={`edit-${n.id}`} value={editText} onChange={(e) => setEditText(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`edit-review-${n.id}`}>Review by (empty = no expiry, Controller approval)</Label>
            <input id={`edit-review-${n.id}`} type="date" value={editReview} onChange={(e) => setEditReview(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-sm" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button loading={edit.isPending} disabled={editText.trim().length < 3} onClick={() => edit.mutate(undefined)}>
              Save new version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject AI context</DialogTitle>
            <DialogDescription>The note won&apos;t be applied. Your reason is logged with the decision.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`reject-${n.id}`}>Reason (optional)</Label>
            <Textarea id={`reject-${n.id}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. This only applied to the July true-up." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={reject.isPending} onClick={() => reject.mutate(reason.trim())}>
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
