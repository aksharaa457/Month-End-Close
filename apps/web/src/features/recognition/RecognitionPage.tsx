import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { FileSignature } from "lucide-react";
import { api } from "@/shared/api/client";
import { PERIOD } from "@/shared/api/hooks";
import type { RecognitionView } from "@/shared/api/types";
import { money, moneyCompact, pct } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Amount, ChartCard, PageHeader, ReleaseTag, SectionTitle, StatCard } from "@/shared/ui/domain";
import { EmptyState, Skeleton } from "@/shared/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/shared/ui/table";
import { BatchSignOffPanel } from "./BatchSignOffPanel";
import { ContractDrawer } from "./ContractDrawer";
import { GatingBoard } from "./GatingBoard";
import { PolicyPanel } from "./PolicyPanel";
import { recKey } from "./shared";

const FOCUS_MONTH = "Aug";

/** Revenue recognition (F9 · US-26, US-27 · RR-1..RR-7 · §10.1). */
export default function RecognitionPage() {
  const { entityId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const q = useQuery({ queryKey: recKey(entityId), queryFn: () => api.get<RecognitionView>(`/entities/${entityId}/recognition`), enabled: !!entityId });

  const openId = params.get("contract");
  const setOpen = (id: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set("contract", id);
        else next.delete("contract");
        return next;
      },
      { replace: true },
    );

  const header = (
    <PageHeader
      eyebrow={
        <>
          <span>Close · {PERIOD}</span>
          <ReleaseTag release="v1" />
        </>
      }
      title="Revenue recognition"
      description="Contracts are checked against the ASC 606 model. Results are proposals: a person confirms every one, one by one or in a batch sign-off."
    />
  );

  if (q.isLoading) {
    return (
      <div>
        {header}
        <Skeleton className="h-72" />
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="mt-4 h-64" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div>
        {header}
        <EmptyState title="Couldn't load recognition" description="Try again in a moment." action={<Button variant="outline" size="sm" onClick={() => q.refetch()}>Retry</Button>} />
      </div>
    );
  }

  const { monthly, kpis, contracts, policy } = q.data;
  if (contracts.length === 0) {
    return (
      <div>
        {header}
        <EmptyState
          icon={<FileSignature className="size-6" />}
          title="Recognition isn't configured for this entity yet"
          description="Connect a contracts source (e.g. Salesforce or HubSpot) and import schedules to start the gating queue."
        />
      </div>
    );
  }

  const currency = contracts[0]?.currency ?? "USD";
  const focus = monthly.find((m) => m.month === FOCUS_MONTH);
  const delta = focus ? focus.recognised - focus.planned : 0;
  const deltaPct = focus && focus.planned ? (delta / focus.planned) * 100 : null;
  const compliancePct = kpis.complianceTotal ? (kpis.complianceRead / kpis.complianceTotal) * 100 : 0;
  const autoCount = contracts.filter((c) => c.column === "auto_applied").length;
  const openContract = contracts.find((c) => c.id === openId) ?? null;
  const chartData = monthly.map((m) => ({ ...m, recognised: m.recognised || null }));

  return (
    <div className="min-w-0">
      {header}

      <ChartCard
        title="Planned vs recognised"
        description={
          focus ? (
            <>
              August: recognised {moneyCompact(focus.recognised, currency)} vs plan {moneyCompact(focus.planned, currency)} ·{" "}
              <span className={cn("font-semibold", delta < 0 ? "text-destructive" : "text-success")}>
                {money(delta, currency, { signed: true })} ({pct(deltaPct, 1, true)})
              </span>
            </>
          ) : (
            "By month"
          )
        }
        chart={
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={{ stroke: "hsl(var(--border))" }} />
                <YAxis tickFormatter={(v: number) => moneyCompact(v, currency)} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={56} />
                <ChartTooltip
                  formatter={(v: number, name: string) => [money(v, currency), name]}
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="recognised" name="Recognised" radius={[3, 3, 0, 0]} fill="hsl(var(--primary))">
                  {chartData.map((m) => (
                    <Cell key={m.month} fill={m.month === FOCUS_MONTH ? "hsl(var(--ai))" : "hsl(var(--primary))"} />
                  ))}
                </Bar>
                <Line dataKey="planned" name="Planned" type="monotone" stroke="hsl(var(--muted-foreground))" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        }
        table={
          <Table>
            <THead>
              <TR>
                <TH>Month</TH>
                <TH className="text-right">Planned</TH>
                <TH className="text-right">Recognised</TH>
                <TH className="text-right">Delta</TH>
              </TR>
            </THead>
            <TBody>
              {monthly.map((m) => (
                <TR key={m.month} className={cn(m.month === FOCUS_MONTH && "bg-ai-soft/60 font-medium")}>
                  <TD>{m.month}</TD>
                  <TD className="text-right">
                    <Amount value={m.planned} currency={currency} />
                  </TD>
                  <TD className="text-right">{m.recognised ? <Amount value={m.recognised} currency={currency} /> : <span className="text-muted-foreground">—</span>}</TD>
                  <TD className="text-right">{m.recognised ? <Amount value={m.recognised - m.planned} currency={currency} signed /> : <span className="text-muted-foreground">—</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        }
      />

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Contracted ARR" value={moneyCompact(kpis.contractedArr, currency)} sub={`Monthly revenue ${moneyCompact(kpis.monthlyRevenue, currency)}`} />
        <StatCard label="Deviations" value={kpis.deviations} tone={kpis.deviations ? "warning" : "success"} sub="Contracts off their schedule" />
        <StatCard
          label="ASC 606 compliance"
          value={pct(compliancePct, 0)}
          tone={compliancePct < 50 ? "warning" : "default"}
          sub={`${kpis.complianceRead} of ${kpis.complianceTotal} read from the signed document`}
        />
        <StatCard label="Auto-applied this period" value={money(kpis.autoAppliedTotal, currency)} tone="ai" sub={`${autoCount} item${autoCount === 1 ? "" : "s"} · policy v${policy.version}`} />
      </div>

      <div className="mt-6">
        <SectionTitle right={<span className="text-xs text-muted-foreground">Select a contract to see evidence and decide</span>}>Gating queue</SectionTitle>
        <GatingBoard contracts={contracts} onOpen={(id) => setOpen(id)} policyVersion={policy.version} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BatchSignOffPanel entityId={entityId} contracts={contracts} policy={policy} onOpen={(id) => setOpen(id)} />
        <PolicyPanel entityId={entityId} policy={policy} currency={currency} />
      </div>

      <ContractDrawer contract={openContract} entityId={entityId} policyVersion={policy.version} onOpenChange={(o) => !o && setOpen(null)} />
    </div>
  );
}
