import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, GitBranch, Plus, RotateCw, Save, Send, Trash2, Undo2, X } from "lucide-react";
import { api } from "@/shared/api/client";
import type { AccountMapping, JeDraft } from "@/shared/api/types";
import { qk, useAction, useCan, useMe, useUserName } from "@/shared/api/hooks";
import { dateTimeLabel, money } from "@/shared/lib/format";
import { jeStatusMeta } from "@/shared/lib/labels";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/shared/ui/dialog";
import { AiPanel, ReasonDialog, SectionTitle } from "@/shared/ui/domain";
import { Input, Label, Select } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/shared/ui/table";
import { CommentThread } from "@/features/checklist/CommentThread";

export function DraftDrawer({ draftId, entityId, onClose }: { draftId: string | null; entityId: string; onClose: () => void }) {
  return (
    <Dialog open={!!draftId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-describedby={undefined} className="max-w-3xl">
        {draftId ? <Body id={draftId} entityId={entityId} /> : null}
      </SheetContent>
    </Dialog>
  );
}

interface EditLine {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}

function Body({ id, entityId }: { id: string; entityId: string }) {
  const can = useCan();
  const me = useMe();
  const name = useUserName();
  const q = useQuery({ queryKey: ["draft", id], queryFn: () => api.get<JeDraft>(`/je-drafts/${id}`) });
  const accounts = useQuery({ queryKey: ["accounts", entityId], queryFn: () => api.get<AccountMapping[]>(`/entities/${entityId}/account-mappings`), staleTime: 60_000 });
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [desc, setDesc] = useState("");
  const [reject, setReject] = useState(false);
  const d = q.data;
  useEffect(() => {
    if (d && !editing) {
      setLines(d.lines.map((l) => ({ accountId: l.accountId, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "", memo: l.memo })));
      setDesc(d.description);
    }
  }, [d, editing]);
  const inv = [qk.drafts(entityId), ["draft", id], qk.flux(entityId), qk.period(entityId)];
  const save = useAction(
    () =>
      api.patch<JeDraft>(`/je-drafts/${id}`, {
        version: d!.version,
        description: desc,
        lines: lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0), memo: l.memo })),
      }),
    { invalidate: inv, success: "Entry saved — you're now its preparer", onSuccess: () => setEditing(false) },
  );
  const act = useAction((v: { action: string; comment?: string }) => api.post<JeDraft>(`/je-drafts/${id}/${v.action}`, { version: d!.version, comment: v.comment }), {
    invalidate: inv,
    success: (r) => `${r.number}: ${jeStatusMeta[r.status].label}`,
    onSuccess: () => setReject(false),
  });

  const totals = useMemo(() => {
    const dr = lines.reduce((x, l) => x + Number(l.debit || 0), 0);
    const cr = lines.reduce((x, l) => x + Number(l.credit || 0), 0);
    return { dr, cr, balanced: Math.round(dr * 100) === Math.round(cr * 100) && dr > 0 };
  }, [lines]);

  if (q.isLoading || !d)
    return (
      <div className="space-y-3 p-6">
        <DialogTitle className="sr-only">Loading journal entry</DialogTitle>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
      </div>
    );

  const meta = jeStatusMeta[d.status];
  const uid = me.data?.user.id;
  const editable = ["draft", "rejected"].includes(d.status) && can("je.prepare", entityId);
  const approvalsThisVersion = d.approvals.filter((a) => a.draftVersion === d.version && a.decision === "approved");
  const iApproved = approvalsThisVersion.some((a) => a.approverId === uid);
  const canApprove = d.status === "submitted" && can("je.approve", entityId) && d.preparerId !== uid && !iApproved;
  const postable = (accounts.data ?? []).slice().sort((a, b) => a.erpCode.localeCompare(b.erpCode));

  return (
    <>
      <div className="border-b p-5 pr-10">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {d.type} · {d.createdByAi ? "AI drafted" : "Manual"} · v{d.version}
        </p>
        <DialogTitle className="text-lg font-semibold">{d.number}</DialogTitle>
        <DialogDescription className="mt-0.5 text-sm text-muted-foreground">{d.description}</DialogDescription>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant={meta.tone}>{meta.label}</Badge>
          <span className="text-sm font-semibold tabular">{money(d.totalDebit, d.currency)}</span>
          {d.requiresSecondApproval ? <Badge variant="warning">Needs 2 approvals</Badge> : null}
          {d.erpDocNumber ? <Badge variant="success">ERP {d.erpDocNumber}</Badge> : null}
          {d.sourceChanged ? <Badge variant="warning">Source changed since drafting</Badge> : null}
        </div>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {d.status === "post_failed" ? (
          <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="flex-1">
              <p className="font-medium">Approved, but the ERP rejected the post</p>
              <p className="text-muted-foreground">{d.postingAttempts[d.postingAttempts.length - 1]?.error}</p>
              <p className="mt-1 text-xs text-muted-foreground">Retrying first looks the entry up by its external ID, so it can never post twice.</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => act.mutate({ action: "retry-posting" })} loading={act.isPending}>
              <RotateCw /> Retry
            </Button>
          </div>
        ) : null}

        {d.sourceLabel ? (
          <p className="text-sm">
            Source:{" "}
            {d.sourceType === "variance" && d.sourceId ? (
              <Link to={`/e/${entityId}/flux?variance=${d.sourceId}`} className="text-accent hover:underline">
                {d.sourceLabel} variance
              </Link>
            ) : d.sourceType === "accrual_proposal" ? (
              <Link to={`/e/${entityId}/accruals`} className="text-accent hover:underline">
                {d.sourceLabel}
              </Link>
            ) : d.sourceType === "ic_true_up" ? (
              <Link to="/consolidation" className="text-accent hover:underline">
                {d.sourceLabel}
              </Link>
            ) : (
              d.sourceLabel
            )}
          </p>
        ) : null}
        {d.aiOutput ? <AiPanel output={d.aiOutput} title="Why the AI drafted this" /> : null}

        <section>
          <SectionTitle
            right={
              editable && !editing ? (
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  Edit lines
                </Button>
              ) : null
            }
          >
            Lines
          </SectionTitle>
          {editing ? (
            <div className="space-y-2">
              <div className="grid gap-1">
                <Label htmlFor="je-desc">Description</Label>
                <Input id="je-desc" value={desc} onChange={(e) => setDesc(e.target.value)} />
              </div>
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-[minmax(0,2fr)_1fr_1fr_auto]">
                  <Select aria-label={`Line ${i + 1} account`} value={l.accountId} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, accountId: e.target.value } : x)))} className="col-span-2 sm:col-span-1">
                    <option value="">Choose account…</option>
                    {postable.map((a) => (
                      <option key={a.accountId} value={a.accountId}>
                        {a.erpCode} · {a.name}
                      </option>
                    ))}
                  </Select>
                  <Input aria-label={`Line ${i + 1} debit`} inputMode="decimal" placeholder="Debit" value={l.debit} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, debit: e.target.value, credit: e.target.value ? "" : x.credit } : x)))} />
                  <Input aria-label={`Line ${i + 1} credit`} inputMode="decimal" placeholder="Credit" value={l.credit} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, credit: e.target.value, debit: e.target.value ? "" : x.debit } : x)))} />
                  <Button variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { accountId: "", debit: "", credit: "", memo: "" }])}>
                  <Plus /> Add line
                </Button>
                <p className={cn("text-sm tabular", totals.balanced ? "text-success" : "text-destructive")}>
                  Debits {money(totals.dr, d.currency)} · Credits {money(totals.cr, d.currency)} {totals.balanced ? "· balanced" : "· doesn't balance"}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  <X /> Cancel
                </Button>
                <Button onClick={() => save.mutate(undefined)} loading={save.isPending} disabled={lines.some((l) => !l.accountId)}>
                  <Save /> Save (v{d.version + 1})
                </Button>
              </div>
            </div>
          ) : d.lines.length ? (
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Account</TH>
                  <TH className="text-right">Debit</TH>
                  <TH className="text-right">Credit</TH>
                </TR>
              </THead>
              <TBody>
                {d.lines.map((l) => (
                  <TR key={l.id}>
                    <TD className="text-muted-foreground">{l.lineNo}</TD>
                    <TD>
                      <span className="mr-1 text-xs text-muted-foreground">{l.accountCode}</span>
                      {l.accountName}
                      {l.memo ? <div className="text-xs text-muted-foreground">{l.memo}</div> : null}
                    </TD>
                    <TD className="text-right tabular">{l.debit ? money(l.debit, d.currency) : ""}</TD>
                    <TD className="text-right tabular">{l.credit ? money(l.credit, d.currency) : ""}</TD>
                  </TR>
                ))}
                <TR className="font-semibold">
                  <TD />
                  <TD>Total</TD>
                  <TD className="text-right tabular">{money(d.totalDebit, d.currency)}</TD>
                  <TD className="text-right tabular">{money(d.totalCredit, d.currency)}</TD>
                </TR>
              </TBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No lines yet. Edit the entry to add at least two balanced lines.</p>
          )}
        </section>

        <section>
          <SectionTitle
            right={
              can("audit.view") ? (
                <Link to={`/audit/trace/${d.id}`} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                  <GitBranch className="size-3.5" /> Full audit trace
                </Link>
              ) : null
            }
          >
            Approvals and posting
          </SectionTitle>
          <ol className="space-y-1.5 text-sm">
            <li className="flex gap-2">
              <span className="text-muted-foreground">Prepared by</span> {name(d.preparerId)}
              {d.createdByAi ? <span className="text-muted-foreground">(from an AI draft)</span> : null}
            </li>
            {d.approvals.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-2">
                <Badge variant={a.decision === "approved" ? "success" : "destructive"}>
                  L{a.level} {a.decision}
                </Badge>
                {name(a.approverId)} · v{a.draftVersion} · {dateTimeLabel(a.decidedAt)}
                {a.batchId ? <span className="text-muted-foreground">(batch)</span> : null}
                {a.comment ? <span className="text-muted-foreground">"{a.comment}"</span> : null}
              </li>
            ))}
            {d.postingAttempts.map((p) => (
              <li key={p.attemptNo} className="flex flex-wrap gap-2">
                <Badge variant={p.status === "succeeded" ? "success" : "destructive"}>Post #{p.attemptNo}</Badge>
                {p.erpDocNumber ?? p.error} · {dateTimeLabel(p.at)}
              </li>
            ))}
          </ol>
        </section>

        <section>
          <SectionTitle>Comments</SectionTitle>
          <CommentThread subjectType="je_draft" subjectId={d.id} />
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/30 p-4">
        {editable && !editing ? (
          <>
            <Button variant="ghost" onClick={() => act.mutate({ action: "withdraw" })}>
              <Undo2 /> Withdraw
            </Button>
            <Button onClick={() => act.mutate({ action: "submit" })} loading={act.isPending}>
              <Send /> Submit for approval
            </Button>
          </>
        ) : null}
        {d.status === "submitted" ? (
          canApprove ? (
            <>
              <Button variant="outline" onClick={() => setReject(true)}>
                <X /> Reject
              </Button>
              <Button variant="success" onClick={() => act.mutate({ action: "approve" })} loading={act.isPending}>
                <Check /> {approvalsThisVersion.length && d.requiresSecondApproval ? "Give second approval" : "Approve"}
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              {d.preparerId === uid
                ? "You prepared this entry, so someone else must approve it (SOD)."
                : iApproved
                  ? "You've approved — a different person must give the second approval."
                  : "Waiting for an approver."}
            </span>
          )
        ) : null}
      </div>
      <ReasonDialog
        open={reject}
        onOpenChange={setReject}
        title={`Reject ${d.number}?`}
        description="The preparer sees your reason and can fix and resubmit the entry."
        confirmLabel="Reject entry"
        destructive
        loading={act.isPending}
        onConfirm={(c) => act.mutate({ action: "reject", comment: c })}
      />
    </>
  );
}
