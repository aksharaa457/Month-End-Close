import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CheckCheck, FilePlus2, Info, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/shared/api/client";
import type { JeDraft, JeList, JeStatus, Job } from "@/shared/api/types";
import { PERIOD, qk, useAction, useCan, useEntities, useJob, useMe, useUserName } from "@/shared/api/hooks";
import { money, periodLabel } from "@/shared/lib/format";
import { jeStatusMeta } from "@/shared/lib/labels";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Amount, JobProgress, PageHeader, StatCard } from "@/shared/ui/domain";
import { Checkbox, EmptyState, Tooltip } from "@/shared/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/shared/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { PageFallback } from "@/app/AppShell";
import { DraftDrawer } from "./DraftDrawer";

type Filter = "review" | "drafts" | "posted" | "all";
const FILTERS: Record<Filter, JeStatus[] | null> = {
  review: ["submitted"],
  drafts: ["draft", "rejected"],
  posted: ["approved", "posting", "posted", "post_failed"],
  all: null,
};

export default function JournalsPage() {
  const { entityId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const can = useCan();
  const me = useMe();
  const name = useUserName();
  const entity = useEntities().data?.find((e) => e.id === entityId);
  const q = useQuery({
    queryKey: qk.drafts(entityId),
    queryFn: () => api.get<JeList>(`/entities/${entityId}/periods/${PERIOD}/je-drafts`),
    // Posting runs in the worker: keep refreshing while any entry is on its way to the ERP.
    refetchInterval: (query) => (query.state.data?.drafts.some((d) => d.status === "approved" || d.status === "posting") ? 1500 : false),
  });
  const [filter, setFilter] = useState<Filter>("review");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const inv = [qk.drafts(entityId), qk.flux(entityId), qk.period(entityId)];

  useEffect(() => {
    const n = params.get("generated");
    if (n !== null) {
      toast.success(`${n} draft entr${n === "1" ? "y" : "ies"} prepared by AI — review and submit them`);
      setFilter("drafts");
      const next = new URLSearchParams(params);
      next.delete("generated");
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const batch = useAction((items: { id: string; version: number }[]) => api.post<Job>("/je-batches/approve", { items }), {
    invalidate: inv,
    onSuccess: (j) => {
      setJobId(j.id);
      setConfirmOpen(false);
      setSelected(new Set());
    },
  });
  const job = useJob(jobId, (j) => {
    const r = j.result as { approved: number; posted: number; awaitingSecond: number } | undefined;
    if (j.status === "succeeded" && r) toast.success(`${r.approved} approved · ${r.posted} posted to the ERP${r.awaitingSecond ? ` · ${r.awaitingSecond} awaiting a second approver` : ""}`);
    batch.reset();
    void q.refetch();
  });
  const createManual = useAction(() => api.post<JeDraft>(`/entities/${entityId}/periods/${PERIOD}/je-drafts`, { type: "correction", description: "Manual journal entry" }), {
    invalidate: inv,
    success: "Manual entry created",
    onSuccess: (d) => openDraft(d.id),
  });

  const drafts = q.data?.drafts ?? [];
  const visible = useMemo(() => (FILTERS[filter] ? drafts.filter((d) => FILTERS[filter]!.includes(d.status)) : drafts), [drafts, filter]);
  const uid = me.data?.user.id;
  const approvable = (d: JeDraft) =>
    d.status === "submitted" && d.preparerId !== uid && can("je.approve", entityId) && !d.approvals.some((a) => a.decision === "approved" && a.draftVersion === d.version && a.approverId === uid);
  const selectable = visible.filter(approvable);
  const chosen = drafts.filter((d) => selected.has(d.id));
  const chosenTotal = chosen.reduce((x, d) => x + d.totalDebit, 0);

  const draftId = params.get("draft");
  const openDraft = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("draft", id);
    else next.delete("draft");
    setParams(next, { replace: true });
  };

  if (q.isLoading) return <PageFallback />;
  if (!q.data) return null;
  const { summary, policy } = q.data;
  const ccy = entity?.functionalCurrency ?? "USD";
  const review = summary.byStatus.submitted;

  return (
    <div>
      <PageHeader
        eyebrow={entity?.name}
        title={`Journal entries · ${periodLabel(PERIOD)}`}
        description="AI-prepared entries, each tied to the variance and ledger data behind it. A person approves every entry before it posts to the ERP."
        actions={
          can("je.prepare", entityId) ? (
            <Button variant="outline" onClick={() => createManual.mutate(undefined)} loading={createManual.isPending}>
              <FilePlus2 /> New manual entry
            </Button>
          ) : null
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Ready for review" value={review.count} sub={money(review.total, ccy)} tone="warning" />
        <StatCard label="All live entries" value={summary.count} sub={`${money(summary.total, ccy)} total (calculated from lines)`} />
        <StatCard label="Posted" value={summary.byStatus.posted.count} sub={money(summary.byStatus.posted.total, ccy)} tone="success" />
        <StatCard label="Approved, not posted" value={summary.byStatus.post_failed.count} tone={summary.byStatus.post_failed.count ? "danger" : "default"} sub="ERP rejected the post" />
      </div>

      <div className="mb-3 flex flex-wrap items-start gap-2 rounded-md border bg-card p-3 text-xs text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-success" />
        <p className="flex-1">
          Human in the loop: the AI service can draft but never approve or post. You can't approve an entry you prepared or last edited. Entries above{" "}
          <span className="font-medium text-foreground">{money(policy.secondApprovalAbove, policy.currency)}</span> need a second approver (policy v{policy.version}).
        </p>
      </div>

      {job && job.status !== "succeeded" ? (
        <div className="mb-3">
          <JobProgress job={job} />
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList aria-label="Filter entries">
            <TabsTrigger value="review">Awaiting approval ({summary.byStatus.submitted.count})</TabsTrigger>
            <TabsTrigger value="drafts">Drafts ({summary.byStatus.draft.count + summary.byStatus.rejected.count})</TabsTrigger>
            <TabsTrigger value="posted">Approved & posted</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        {can("je.approve", entityId) ? (
          <Button variant="ai" disabled={!chosen.length} onClick={() => setConfirmOpen(true)}>
            <CheckCheck /> Approve {chosen.length || ""} {chosen.length ? `at ${money(chosenTotal, ccy)}` : "selected"}
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No entries here" description={filter === "review" ? "Nothing is waiting for approval." : "Use “Draft JEs for flagged lines” on Flux & variance to have the AI prepare entries."} />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH className="w-8">
                  <Checkbox
                    aria-label="Select all approvable entries"
                    checked={selectable.length > 0 && selectable.every((d) => selected.has(d.id))}
                    disabled={!selectable.length}
                    onCheckedChange={(c) => setSelected(c ? new Set(selectable.map((d) => d.id)) : new Set())}
                  />
                </TH>
                <TH>Entry</TH>
                <TH className="hidden md:table-cell">Type</TH>
                <TH>Source</TH>
                <TH className="text-right">Amount</TH>
                <TH className="hidden lg:table-cell">Preparer</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {visible.map((d) => {
                const meta = jeStatusMeta[d.status];
                const ok = approvable(d);
                const own = d.preparerId === uid && d.status === "submitted";
                return (
                  <TR key={d.id} className="cursor-pointer" onClick={() => openDraft(d.id)}>
                    <TD onClick={(e) => e.stopPropagation()}>
                      {d.status === "submitted" ? (
                        <Tooltip content={ok ? "Select for batch approval" : own ? "You prepared this entry, so you can't approve it" : "You can't approve this entry"}>
                          <span>
                            <Checkbox
                              aria-label={`Select ${d.number}`}
                              disabled={!ok}
                              checked={selected.has(d.id)}
                              onCheckedChange={(c) =>
                                setSelected((s) => {
                                  const n = new Set(s);
                                  if (c) n.add(d.id);
                                  else n.delete(d.id);
                                  return n;
                                })
                              }
                            />
                          </span>
                        </Tooltip>
                      ) : null}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-1.5 font-medium">
                        {d.number}
                        {d.createdByAi ? <Sparkles className="size-3.5 text-ai" aria-label="AI drafted" /> : null}
                      </div>
                      <div className="max-w-[18rem] truncate text-xs text-muted-foreground">{d.description}</div>
                    </TD>
                    <TD className="hidden capitalize md:table-cell">{d.type}</TD>
                    <TD className="max-w-[14rem] truncate text-xs">{d.sourceLabel ?? "Manual"}</TD>
                    <TD className="text-right">
                      <Amount value={d.totalDebit} currency={d.currency} />
                      {d.requiresSecondApproval ? <div className="text-[10px] text-warning">2 approvals</div> : null}
                    </TD>
                    <TD className="hidden text-xs lg:table-cell">{name(d.preparerId)}</TD>
                    <TD>
                      <Badge variant={meta.tone}>{meta.label}</Badge>
                      {d.erpDocNumber ? <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{d.erpDocNumber}</div> : null}
                      {d.sourceChanged ? <div className="text-[10px] text-warning">Source changed</div> : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Approve {chosen.length} entries at {money(chosenTotal, ccy)}?
            </DialogTitle>
            <DialogDescription>Each entry gets its own approval record. Entries that need a second approver wait for one; the rest post to the ERP straight away.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-60 divide-y overflow-y-auto rounded-md border text-sm">
            {chosen.map((d) => (
              <li key={d.id} className="flex justify-between gap-2 px-3 py-1.5">
                <span className="truncate">
                  {d.number} · {d.sourceLabel ?? d.description}
                </span>
                <Amount value={d.totalDebit} currency={d.currency} />
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" /> The total is calculated from the entry lines, not typed in.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => batch.mutate(chosen.map((d) => ({ id: d.id, version: d.version })))} loading={batch.isPending}>
              <CheckCheck /> Approve {chosen.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DraftDrawer draftId={draftId} entityId={entityId} onClose={() => openDraft(null)} />
    </div>
  );
}
