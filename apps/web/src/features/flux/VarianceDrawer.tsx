import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Check, FileText, Info, ListTree, NotebookPen, RotateCcw, ShieldCheck } from "lucide-react";
import { api } from "@/shared/api/client";
import type { ContextNote, Variance } from "@/shared/api/types";
import { qk, useAction, useCan, useUserName } from "@/shared/api/hooks";
import { dateLabel, money, pct } from "@/shared/lib/format";
import { varianceStatusMeta } from "@/shared/lib/labels";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/shared/ui/dialog";
import { AiPanel, Amount, ReasonDialog, SectionTitle } from "@/shared/ui/domain";
import { FieldError, Input, Label, Select, Textarea } from "@/shared/ui/input";
import { Checkbox } from "@/shared/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { CommentThread } from "@/features/checklist/CommentThread";

export function VarianceDrawer({ variance, entityId, currency, onClose }: { variance: Variance | null; entityId: string; currency: string; onClose: () => void }) {
  return (
    <Dialog open={!!variance} onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-describedby={undefined}>{variance ? <Body v={variance} entityId={entityId} ccy={currency} /> : null}</SheetContent>
    </Dialog>
  );
}

interface GlLine {
  id: string;
  ref: string;
  postingDate: string;
  amount: number;
  memo: string;
}

function Body({ v, entityId, ccy }: { v: Variance; entityId: string; ccy: string }) {
  const can = useCan();
  const name = useUserName();
  const [manual, setManual] = useState("");
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const inv = [qk.flux(entityId), qk.period(entityId), ["je-candidates", entityId]];
  const lines = useQuery({ queryKey: ["gl-lines", v.id], queryFn: () => api.get<GlLine[]>(`/variances/${v.id}/lines`) });
  const signOff = useAction(() => api.post(`/variances/${v.id}/sign-off`, { version: v.version, manualExplanation: manual || undefined }), { invalidate: inv, success: "Variance signed off" });
  const exception = useAction((reason: string) => api.post(`/variances/${v.id}/exception`, { reason }), { invalidate: inv, success: "Exception approved", onSuccess: () => setExceptionOpen(false) });
  const reopen = useAction(() => api.post(`/variances/${v.id}/reopen`), { invalidate: inv, success: "Sign-off withdrawn" });
  const meta = varianceStatusMeta[v.status];
  const signed = v.status === "signed_off" || v.status === "exception";
  const canSign = can("task.signoff", entityId);
  const maxShare = Math.max(1, ...v.attributions.map((a) => Math.abs(a.sharePct)));

  return (
    <>
      <div className="border-b p-5 pr-10">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {v.isGroup ? "Account group" : v.accountCode} · {v.accountClass}
        </p>
        <DialogTitle className="text-lg font-semibold">{v.accountName}</DialogTitle>
        <DialogDescription className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="tabular text-muted-foreground">{money(v.prior, ccy)}</span>
          <span aria-hidden>→</span>
          <span className="tabular font-medium">{money(v.current, ccy)}</span>
          <Amount value={v.delta} currency={ccy} signed className="font-semibold" />
          <span className={cn("tabular", v.deltaPct !== null && v.deltaPct < 0 && "text-destructive")}>({pct(v.deltaPct, 1, true)})</span>
        </DialogDescription>
        <div className="mt-2 flex flex-wrap gap-2">
          {v.isFlagged ? <Badge variant={meta.tone}>{meta.label}</Badge> : <Badge variant="outline">Within threshold</Badge>}
          {v.isFlagged ? <Badge variant="outline">Flagged by threshold v{v.thresholdVersion}</Badge> : null}
          {v.changedAfterSignoff ? <Badge variant="warning">Explanation changed after sign-off</Badge> : null}
        </div>
      </div>

      <Tabs defaultValue="explain" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-5 mt-3 self-start" aria-label="Variance detail">
          <TabsTrigger value="explain">
            <FileText className="size-3.5" /> Explanation
          </TabsTrigger>
          <TabsTrigger value="context">
            <NotebookPen className="size-3.5" /> AI context
          </TabsTrigger>
          <TabsTrigger value="comments">Comments</TabsTrigger>
        </TabsList>

        <TabsContent value="explain" className="flex-1 space-y-5 overflow-y-auto p-5 pt-2">
          <AiPanel output={v.explanation} />
          {v.status === "needs_manual" && canSign ? (
            <div className="grid gap-1.5">
              <Label htmlFor="manual">Manual explanation (required to sign off)</Label>
              <Textarea id="manual" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="What drives this movement, and what evidence did you check?" />
              <p className="text-[11px] text-muted-foreground">The AI found no usable data for this line, so it can't be signed off with a blank explanation (EC-8).</p>
            </div>
          ) : null}

          {v.attributions.length ? (
            <section>
              <SectionTitle>Attribution by child</SectionTitle>
              <ul className="space-y-2">
                {v.attributions.map((a) => (
                  <li key={a.accountId}>
                    <div className="mb-0.5 flex justify-between gap-2 text-sm">
                      <span className="truncate">
                        <span className="mr-1 text-xs text-muted-foreground">{a.accountCode}</span>
                        {a.accountName}
                      </span>
                      <span className="shrink-0 tabular">
                        <Amount value={a.amount} currency={ccy} signed /> · {a.sharePct}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full", a.amount < 0 ? "bg-destructive" : "bg-success")} style={{ width: `${(Math.abs(a.sharePct) / maxShare) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <SectionTitle>
              <span className="flex items-center gap-1">
                <ListTree className="size-3.5" /> Ledger lines behind this movement
              </span>
            </SectionTitle>
            {lines.data?.length ? (
              <ul className="divide-y rounded-md border text-sm">
                {lines.data.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
                    <span className="font-mono text-xs">{l.ref}</span>
                    <span className="text-xs text-muted-foreground">{dateLabel(l.postingDate)}</span>
                    <span className="min-w-0 flex-1 truncate">{l.memo}</span>
                    <Amount value={l.amount} currency={ccy} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No synced ledger lines are linked to this account for the period.</p>
            )}
          </section>

          {v.draftIds.length ? (
            <section>
              <SectionTitle>Journal entries</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {v.draftIds.map((id) => (
                  <Button key={id} asChild variant="outline" size="sm">
                    <Link to={`/e/${entityId}/journals?draft=${id}`}>{id.toUpperCase()}</Link>
                  </Button>
                ))}
              </div>
            </section>
          ) : null}
        </TabsContent>

        <TabsContent value="context" className="flex-1 overflow-y-auto p-5 pt-2">
          <ContextTab v={v} entityId={entityId} />
        </TabsContent>
        <TabsContent value="comments" className="flex-1 overflow-y-auto p-5 pt-2">
          <p className="mb-3 flex items-start gap-1.5 rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" /> Comments are notes for colleagues. They don't change how the AI evaluates this line — use AI context for that.
          </p>
          <CommentThread subjectType="variance" subjectId={v.id} />
        </TabsContent>
      </Tabs>

      {v.isFlagged ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/30 p-4">
          {signed ? (
            <>
              <span className="mr-auto text-xs text-muted-foreground">
                {v.status === "exception" ? `Exception: "${v.exceptionReason}" · ` : ""}Signed off by {name(v.signedOffBy)}
              </span>
              {canSign ? (
                <Button variant="outline" size="sm" onClick={() => reopen.mutate(undefined)} loading={reopen.isPending}>
                  <RotateCcw /> Withdraw sign-off
                </Button>
              ) : null}
            </>
          ) : canSign ? (
            <>
              <Button variant="outline" onClick={() => setExceptionOpen(true)}>
                <AlertTriangle /> Approve as exception
              </Button>
              <Button variant="success" onClick={() => signOff.mutate(undefined)} loading={signOff.isPending} disabled={v.status === "needs_manual" && manual.trim().length < 10}>
                <Check /> Sign off
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">A reviewer or controller signs off flagged lines.</span>
          )}
        </div>
      ) : null}
      <ReasonDialog
        open={exceptionOpen}
        onOpenChange={setExceptionOpen}
        title="Approve this variance as an exception?"
        description="Use this when the movement is real but doesn't need a correction. The reason appears in the audit trail and the board pack."
        minLength={10}
        confirmLabel="Approve exception"
        loading={exception.isPending}
        onConfirm={(r) => exception.mutate(r)}
      />
    </>
  );
}

const schema = z.object({
  text: z.string().trim().min(3, "Write at least 3 characters").max(2000),
  scope: z.enum(["account", "account_group", "cross_entity"]),
  reviewBy: z.string().optional(),
  noExpiry: z.boolean(),
});
type Form = z.infer<typeof schema>;

function ContextTab({ v, entityId }: { v: Variance; entityId: string }) {
  const can = useCan();
  const name = useUserName();
  const notes = useQuery({ queryKey: [...qk.contextNotes, v.accountId], queryFn: () => api.get<ContextNote[]>(`/context-notes?accountId=${v.accountId}`) });
  const [last, setLast] = useState<ContextNote | null>(null);
  const form = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { text: "", scope: "account", reviewBy: "2027-09-01", noExpiry: false } });
  const propose = useAction((f: Form) => api.post<ContextNote>(`/variances/${v.id}/context-notes`, f), {
    invalidate: [qk.contextNotes, [...qk.contextNotes, v.accountId], qk.notifications],
    success: "Context proposed — it applies once someone else approves it",
    onSuccess: (n) => {
      setLast(n);
      form.reset({ text: "", scope: "account", reviewBy: "2027-09-01", noExpiry: false });
    },
  });
  const noExpiry = form.watch("noExpiry");
  return (
    <div className="space-y-5">
      <div className="rounded-md border bg-ai-soft/50 p-3 text-xs leading-relaxed">
        <p className="mb-1 flex items-center gap-1 font-semibold text-ai">
          <ShieldCheck className="size-3.5" /> AI context is different from a comment
        </p>
        A comment is a note for a colleague. AI context is a business rule — e.g. "billing occurs every 45 days" — that changes how the AI evaluates this line in every future period. It needs approval by someone other than you, and it has a review-by date.
      </div>

      {can("context.propose", entityId) ? (
        <form className="grid gap-3" onSubmit={form.handleSubmit((f) => propose.mutate(f))}>
          <div className="grid gap-1.5">
            <Label htmlFor="ctx-text">New AI context</Label>
            <Textarea id="ctx-text" placeholder="e.g. billing occurs every 45 days" {...form.register("text")} />
            <FieldError>{form.formState.errors.text?.message}</FieldError>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ctx-scope">Applies to</Label>
              <Select id="ctx-scope" {...form.register("scope")}>
                <option value="account">This account only</option>
                <option value="account_group">This account group</option>
                <option value="cross_entity">All entities (Controller approval)</option>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ctx-review">Review by</Label>
              <Input id="ctx-review" type="date" disabled={noExpiry} {...form.register("reviewBy")} />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox checked={noExpiry} onCheckedChange={(c) => form.setValue("noExpiry", !!c)} aria-label="No expiry" /> No expiry (needs Controller approval)
              </label>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={propose.isPending}>
              <NotebookPen /> Propose context
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Your role can't propose AI context.</p>
      )}

      {last?.previewExplanation ? (
        <div className="rounded-lg border border-dashed border-ai/50 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ai">Preview — not applied until approved</p>
          <p className="text-sm">{last.previewExplanation}</p>
        </div>
      ) : null}

      <section>
        <SectionTitle right={<Link to="/context" className="text-xs text-accent hover:underline">Manage all context</Link>}>Context on this account</SectionTitle>
        {notes.data?.length ? (
          <ul className="space-y-2">
            {notes.data.map((n) => (
              <li key={n.id} className="rounded-md border p-2.5 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant={n.status === "approved" ? "success" : n.status === "pending" ? "warning" : "outline"}>{n.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {name(n.proposedBy)}
                    {n.decidedBy ? ` · ${n.status} by ${name(n.decidedBy)}` : ""} · review by {n.reviewBy ? dateLabel(n.reviewBy) : "no expiry"}
                  </span>
                </div>
                "{n.text}"
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No context on this account yet.</p>
        )}
      </section>
    </div>
  );
}
