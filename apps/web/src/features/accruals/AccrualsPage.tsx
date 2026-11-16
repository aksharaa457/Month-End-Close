import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { Check, ExternalLink, FileSearch, X } from "lucide-react";
import { api } from "@/shared/api/client";
import { PERIOD, qk, useAction, useCan } from "@/shared/api/hooks";
import type { AccrualProposal, AccrualsView } from "@/shared/api/types";
import { money, moneyCompact, pct } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { AiPanel, Amount, ChartCard, PageHeader, ReasonDialog, ReleaseTag, SectionTitle, StatCard } from "@/shared/ui/domain";
import { FieldError, Input, Label } from "@/shared/ui/input";
import { EmptyState, Skeleton } from "@/shared/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/shared/ui/table";

const basisLabel: Record<AccrualProposal["basis"], string> = {
  run_rate: "Run-rate gap",
  contract: "Contract terms",
  open_po: "Open PO, no bill",
};

const statusMeta: Record<AccrualProposal["status"], { label: string; tone: "warning" | "success" | "outline" }> = {
  suggested: { label: "Suggested", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  dismissed: { label: "Dismissed", tone: "outline" },
};

/** Accruals (F8 · US-25 · AC-1..AC-4). */
export default function AccrualsPage() {
  const { entityId = "" } = useParams();
  const can = useCan();
  const canPrepare = can("je.prepare", entityId);
  const q = useQuery({ queryKey: ["accruals", entityId], queryFn: () => api.get<AccrualsView>(`/entities/${entityId}/accruals`), enabled: !!entityId });

  const [approving, setApproving] = useState<AccrualProposal | null>(null);
  const [dismissing, setDismissing] = useState<AccrualProposal | null>(null);
  const [lastDraft, setLastDraft] = useState<{ vendor: string; draftId: string } | null>(null);

  const invalidate = [["accruals", entityId], qk.drafts(entityId)];
  const approve = useAction((v: { id: string; amount: number }) => api.post<AccrualProposal>(`/accruals/${v.id}/approve`, { amount: v.amount }), {
    invalidate,
    success: (p) => `Draft accrual JE created for ${p.vendor}`,
    onSuccess: (p) => {
      setApproving(null);
      if (p.draftId) setLastDraft({ vendor: p.vendor, draftId: p.draftId });
    },
  });
  const dismiss = useAction((v: { id: string; reason: string }) => api.post<AccrualProposal>(`/accruals/${v.id}/dismiss`, { reason: v.reason }), {
    invalidate,
    success: (p) => `Accrual for ${p.vendor} dismissed`,
    onSuccess: () => setDismissing(null),
  });

  const header = (
    <PageHeader
      eyebrow={
        <>
          <span>Close · {PERIOD}</span>
          <ReleaseTag release="v1" />
        </>
      }
      title="Accruals"
      description="Missing accruals detected from ledger activity. Approve one to create a draft accrual JE that reverses next month."
    />
  );

  if (q.isLoading) {
    return (
      <div>
        {header}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="mt-4 h-72" />
        <Skeleton className="mt-4 h-40" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div>
        {header}
        <EmptyState title="Couldn't load accruals" description="Try again in a moment." action={<Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button>} />
      </div>
    );
  }

  const { kpis, categories, proposals, currency } = q.data;
  const delta = kpis.runRate ? ((kpis.categorySpend - kpis.runRate) / kpis.runRate) * 100 : null;
  const open = proposals.filter((p) => p.status === "suggested");
  const decided = proposals.filter((p) => p.status !== "suggested");

  return (
    <div className="min-w-0">
      {header}

      {lastDraft ? (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-success/40 bg-success/5 p-3 text-sm">
          <span className="flex items-center gap-1.5">
            <Check className="size-4 text-success" aria-hidden /> Draft accrual JE created for {lastDraft.vendor}.
          </span>
          <span className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to={`/e/${entityId}/journals?draft=${lastDraft.draftId}`}>
                Open draft <ExternalLink />
              </Link>
            </Button>
            <Button size="icon" variant="ghost" className="size-8" aria-label="Dismiss message" onClick={() => setLastDraft(null)}>
              <X />
            </Button>
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Category spend vs run-rate"
          value={moneyCompact(kpis.categorySpend, currency)}
          sub={
            <>
              Run-rate {moneyCompact(kpis.runRate, currency)} ·{" "}
              <span className={cn(delta !== null && delta < 0 ? "text-warning" : "text-success")}>{pct(delta, 1, true)}</span>
            </>
          }
          tone={delta !== null && delta < -10 ? "warning" : "default"}
        />
        <StatCard label="Accrued liabilities" value={moneyCompact(kpis.accruedLiabilities, currency)} sub="Balance incl. approved accruals" />
        <StatCard label="Prepaid assets" value={moneyCompact(kpis.prepaidAssets, currency)} sub="Balance this period" />
        <StatCard
          label="Needs accrual"
          value={kpis.needsAccrual}
          tone={kpis.needsAccrual ? "warning" : "success"}
          sub={kpis.needsAccrual ? <>Suggested total {money(kpis.suggestedTotal, currency)}</> : "Nothing outstanding"}
        />
      </div>

      <ChartCard
        className="mt-4"
        title="Actual vs run-rate by category"
        description="Categories well below run-rate usually mean a bill hasn't arrived yet."
        chart={
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categories} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="category" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} interval={0} />
                <YAxis tickFormatter={(v: number) => moneyCompact(v, currency)} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={64} />
                <ChartTooltip
                  formatter={(v: number, name: string) => [money(v, currency), name]}
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="actual" name="Actual" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                <Bar dataKey="runRate" name="Run-rate" fill="hsl(var(--muted-foreground))" fillOpacity={0.45} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        }
        table={
          <Table>
            <THead>
              <TR>
                <TH>Category</TH>
                <TH className="text-right">Actual</TH>
                <TH className="text-right">Run-rate</TH>
                <TH className="text-right">Gap</TH>
              </TR>
            </THead>
            <TBody>
              {categories.map((c) => (
                <TR key={c.category}>
                  <TD>{c.category}</TD>
                  <TD className="text-right">
                    <Amount value={c.actual} currency={currency} />
                  </TD>
                  <TD className="text-right">
                    <Amount value={c.runRate} currency={currency} />
                  </TD>
                  <TD className="text-right">
                    <Amount value={c.actual - c.runRate} currency={currency} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        }
      />

      <div className="mt-6">
        <SectionTitle right={<span className="text-xs text-muted-foreground">{open.length} to decide</span>}>Detected from the ledger</SectionTitle>
        {!canPrepare ? <p className="mb-2 text-xs text-muted-foreground">You can view proposals. Approving or dismissing needs preparer access for this entity.</p> : null}
        {proposals.length === 0 ? (
          <EmptyState icon={<FileSearch className="size-6" />} title="No missing accruals detected" description="Recurring vendors, run-rates and open POs all have matching bills this period." />
        ) : (
          <ul className="grid gap-3" aria-label="Accrual proposals">
            {[...open, ...decided].map((p) => (
              <ProposalCard
                key={p.id}
                p={p}
                entityId={entityId}
                canPrepare={canPrepare}
                onApprove={() => setApproving(p)}
                onDismiss={() => setDismissing(p)}
              />
            ))}
          </ul>
        )}
      </div>

      <ApproveDialog
        proposal={approving}
        loading={approve.isPending}
        onOpenChange={(o) => !o && setApproving(null)}
        onConfirm={(amount) => approving && approve.mutate({ id: approving.id, amount })}
      />
      <ReasonDialog
        open={!!dismissing}
        onOpenChange={(o) => !o && setDismissing(null)}
        title={`Dismiss accrual for ${dismissing?.vendor ?? ""}`}
        description="Say why no accrual is needed. The reason is kept in the audit trail."
        label="Reason"
        placeholder="e.g. Invoice received on 1 Sep and booked to August"
        confirmLabel="Dismiss"
        destructive
        loading={dismiss.isPending}
        onConfirm={(reason) => dismissing && dismiss.mutate({ id: dismissing.id, reason })}
      />
    </div>
  );
}

function ProposalCard({ p, entityId, canPrepare, onApprove, onDismiss }: { p: AccrualProposal; entityId: string; canPrepare: boolean; onApprove: () => void; onDismiss: () => void }) {
  const meta = statusMeta[p.status];
  return (
    <li>
      <Card className={cn("p-4", p.status !== "suggested" && "bg-muted/30")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{p.vendor}</h3>
              <Badge variant={meta.tone}>{meta.label}</Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {p.category} · <span className="font-medium text-foreground">{basisLabel[p.basis]}</span>
            </p>
          </div>
          <div className="text-right">
            <Amount value={p.amount} currency={p.currency} className="text-lg font-bold" />
            <div className="text-[11px] text-muted-foreground">{p.status === "approved" ? "Accrued" : "Suggested amount"}</div>
          </div>
        </div>

        <div className="mt-3">
          <AiPanel output={p.ai} title="Why we think this is missing" compact />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {p.status === "suggested" ? (
            <>
              <span className="text-xs text-muted-foreground">Reverses on 1 Sep after posting.</span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={!canPrepare} onClick={onDismiss}>
                  <X /> Dismiss
                </Button>
                <Button size="sm" disabled={!canPrepare} onClick={onApprove}>
                  <Check /> Approve…
                </Button>
              </div>
            </>
          ) : p.status === "approved" ? (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-success">Approved. Draft accrual JE created.</span>
              {p.draftId ? (
                <Link className="inline-flex items-center gap-1 text-accent underline-offset-4 hover:underline" to={`/e/${entityId}/journals?draft=${p.draftId}`}>
                  Open draft <ExternalLink className="size-3.5" aria-hidden />
                </Link>
              ) : null}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Dismissed:</span> {p.dismissReason}
            </p>
          )}
        </div>
      </Card>
    </li>
  );
}

function ApproveDialog({ proposal, loading, onOpenChange, onConfirm }: { proposal: AccrualProposal | null; loading: boolean; onOpenChange: (o: boolean) => void; onConfirm: (amount: number) => void }) {
  return (
    <Dialog open={!!proposal} onOpenChange={onOpenChange}>
      <DialogContent>{proposal ? <ApproveForm key={proposal.id} proposal={proposal} loading={loading} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} /> : null}</DialogContent>
    </Dialog>
  );
}

function ApproveForm({ proposal, loading, onCancel, onConfirm }: { proposal: AccrualProposal; loading: boolean; onCancel: () => void; onConfirm: (amount: number) => void }) {
  const [value, setValue] = useState(String(proposal.amount));
  const [touched, setTouched] = useState(false);
  const amount = Number(value);
  const invalid = value.trim() === "" || !Number.isFinite(amount) || amount <= 0;
  const edited = !invalid && amount !== proposal.amount;
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!invalid) onConfirm(Math.round(amount * 100) / 100);
      }}
    >
      <DialogHeader>
        <DialogTitle>Approve accrual · {proposal.vendor}</DialogTitle>
        <DialogDescription>
          This creates a draft accrual JE (Dr expense, Cr accrued liabilities) that reverses on 1 Sep. It still goes through normal JE approval.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="accrual-amount">Amount ({proposal.currency})</Label>
        <Input
          id="accrual-amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && invalid}
          autoFocus
        />
        <FieldError>{touched && invalid ? "Enter an amount greater than zero." : null}</FieldError>
        <p className="text-xs text-muted-foreground">
          Suggested: {money(proposal.amount, proposal.currency)}
          {edited ? <span className="text-warning"> · edited</span> : null}
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading}>
          Approve and create draft
        </Button>
      </DialogFooter>
    </form>
  );
}
