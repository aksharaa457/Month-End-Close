import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { AlertOctagon, ArrowRight, CheckCircle2, Info, Lock, LockOpen, Sparkles, XCircle } from "lucide-react";
import { api } from "@/shared/api/client";
import type { PeriodDetail } from "@/shared/api/types";
import { PERIOD, qk, useAction, useCan, useEntities, useMe, useUserName } from "@/shared/api/hooks";
import { closeDay, dateLabel, dateTimeLabel, periodLabel } from "@/shared/lib/format";
import { phaseLabel } from "@/shared/lib/labels";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { ChartCard, CitationList, PageHeader, ReasonDialog, ReleaseTag, StatCard } from "@/shared/ui/domain";
import { Progress } from "@/shared/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/shared/ui/table";
import { PageFallback } from "@/app/AppShell";

const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };

export default function OverviewPage() {
  const { entityId = "" } = useParams();
  const entities = useEntities();
  const entity = entities.data?.find((e) => e.id === entityId);
  const q = useQuery({ queryKey: qk.period(entityId), queryFn: () => api.get<PeriodDetail>(`/entities/${entityId}/periods/${PERIOD}`) });
  if (q.isLoading) return <PageFallback />;
  if (!q.data) return null;
  const p = q.data;

  if (entity?.status === "setup_required") {
    return (
      <div>
        <PageHeader title={entity.name} description="This entity isn't connected yet." />
        <Card className="p-6">
          <p className="mb-3 text-sm text-muted-foreground">Connect its {entity.erpType === "sap" ? "SAP" : "NetSuite"} ledger, map the chart of accounts and run a backfill to start closing it in the app.</p>
          <Button asChild>
            <Link to={`/setup?tab=connections&entity=${entityId}`}>
              Set up {entity.name} <ArrowRight />
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  const behind = p.forecast.varianceDays > 0;
  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            {entity?.region} · {entity?.erpType === "sap" ? "SAP" : "NetSuite"} · {entity?.functionalCurrency}
          </>
        }
        title={`${entity?.name ?? ""} · ${periodLabel(p.period)}`}
        description="Close health, where the work stands, and what needs attention."
        actions={
          p.status === "locked" ? (
            <Badge variant="success" className="text-xs">
              <Lock className="size-3" /> Locked {dateTimeLabel(p.lockedAt)}
            </Badge>
          ) : null
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Close health"
          value={closeDay(p.forecast.projectedCloseDay)}
          tone={behind ? "danger" : "success"}
          sub={
            <>
              <span className={behind ? "text-destructive" : "text-success"}>{behind ? `+${p.forecast.varianceDays} vs plan` : "On plan"}</span> · target {closeDay(p.targetCloseDay)} ({dateLabel(p.targetDate)})
            </>
          }
          icon={<Badge variant="ai">AI predicted</Badge>}
        />
        <StatCard label="Complete" value={`${Math.round(p.health.pctComplete)}%`} sub={<Progress value={p.health.pctComplete} className="mt-1" />} />
        <StatCard label="Tasks complete" value={`${p.health.tasksDone} of ${p.health.tasksTotal}`} sub={`${p.health.tasksOpen} open`} />
        <StatCard label="Overdue tasks" value={p.health.tasksOverdue} tone={p.health.tasksOverdue ? "danger" : "success"} sub={`Today is ${closeDay(p.closeDay)}`} />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Close burndown"
          description={
            <>
              Open tasks by close day: plan, actual and AI projection <ReleaseTag release="v1" />
            </>
          }
          chart={
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={p.burndown} margin={{ top: 20, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis dataKey="day" tickFormatter={(d) => `D+${d}`} tick={axis} />
                  <YAxis tick={axis} allowDecimals={false} />
                  <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} labelFormatter={(d) => `D+${d}`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <ReferenceLine x={p.closeDay} stroke="hsl(var(--ai))" strokeOpacity={0.4} strokeWidth={14} label={{ value: "Today", fontSize: 10, fill: "hsl(var(--ai))", position: "top" }} />
                  <Line type="linear" dataKey="plan" name="Plan" stroke="hsl(var(--muted-foreground))" strokeDasharray="5 4" dot={false} />
                  <Line type="linear" dataKey="actual" name="Actual" stroke="hsl(var(--foreground))" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} />
                  <Line type="linear" dataKey="projected" name="AI projected" stroke="hsl(var(--ai))" strokeDasharray="2 3" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          }
          table={
            <Table>
              <THead>
                <TR>
                  <TH>Day</TH>
                  <TH className="text-right">Plan</TH>
                  <TH className="text-right">Actual</TH>
                  <TH className="text-right">AI projected</TH>
                </TR>
              </THead>
              <TBody>
                {p.burndown.map((b) => (
                  <TR key={b.day}>
                    <TD>D+{b.day}</TD>
                    <TD className="text-right tabular">{b.plan}</TD>
                    <TD className="text-right tabular">{b.actual ?? "—"}</TD>
                    <TD className="text-right tabular">{b.projected ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          }
        />
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Sparkles className="size-4 text-ai" /> AI insights <ReleaseTag release="v1" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {p.insights.map((i) => (
                <li key={i.id} className={cn("rounded-md border-l-2 p-2 text-sm", i.severity === "critical" ? "border-l-destructive bg-destructive/5" : i.severity === "warning" ? "border-l-warning bg-warning/5" : "border-l-accent bg-muted/40")}>
                  <Link to={i.link} className="hover:underline">
                    {i.text}
                  </Link>
                  <CitationList citations={i.citations} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Workload by sub-process"
          description={
            <>
              Complete vs open tasks per phase <ReleaseTag release="v1" />
            </>
          }
          chart={
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={p.workload.map((w) => ({ ...w, name: phaseLabel[w.phase] }))} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={axis} interval={0} />
                  <YAxis tick={axis} allowDecimals={false} />
                  <RTooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} cursor={{ fill: "hsl(var(--muted))" }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="complete" name="Complete" stackId="a" fill="hsl(var(--success))" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="open" name="Open" stackId="a" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          }
          table={
            <Table>
              <THead>
                <TR>
                  <TH>Phase</TH>
                  <TH className="text-right">Complete</TH>
                  <TH className="text-right">Open</TH>
                </TR>
              </THead>
              <TBody>
                {p.workload.map((w) => (
                  <TR key={w.phase}>
                    <TD>{phaseLabel[w.phase]}</TD>
                    <TD className="text-right tabular">{w.complete}</TD>
                    <TD className="text-right tabular">{w.open}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          }
        />
        <Card>
          <CardHeader>
            <CardTitle>Modules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {p.modules.map((m) => (
              <Link key={m.key} to={`/e/${entityId}/${m.key === "flux" ? "flux" : m.key}`} className="block rounded-md p-1.5 hover:bg-muted">
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5">
                    {m.name} <ReleaseTag release={m.release} />
                  </span>
                  <span className="tabular text-muted-foreground">{m.pct}%</span>
                </div>
                <Progress value={m.pct} />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <PeriodLockPanel entityId={entityId} p={p} />
    </div>
  );
}

function PeriodLockPanel({ entityId, p }: { entityId: string; p: PeriodDetail }) {
  const can = useCan();
  const me = useMe();
  const name = useUserName();
  const [reopenOpen, setReopenOpen] = useState(false);
  const inv = [qk.period(entityId), qk.tasks(entityId), qk.flux(entityId), qk.drafts(entityId)];
  const lock = useAction(() => api.post(`/entities/${entityId}/periods/${PERIOD}/lock`), { invalidate: inv, success: "Period locked" });
  const request = useAction((reason: string) => api.post(`/entities/${entityId}/periods/${PERIOD}/reopen-requests`, { reason }), {
    invalidate: inv,
    success: "Reopen requested — another controller must approve it",
    onSuccess: () => setReopenOpen(false),
  });
  const decide = useAction((v: { id: string; decision: "approve" | "reject" }) => api.post(`/reopen-requests/${v.id}/${v.decision}`), { invalidate: inv, success: "Reopen request decided" });
  const allMet = p.gates.every((g) => g.met);
  const canLock = can("period.lock", entityId);
  const pending = p.reopenRequests.find((r) => r.status === "pending");

  return (
    <Card id="lock">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-1.5">{p.status === "locked" ? <Lock className="size-4" /> : <LockOpen className="size-4" />} Period lock</CardTitle>
          <p className="text-xs text-muted-foreground">The period locks only when every gate is met. After that, changes need a reopen with a reason and a second person's approval.</p>
        </div>
        {p.status === "open" ? (
          <Button onClick={() => lock.mutate(undefined)} disabled={!canLock || !allMet} loading={lock.isPending} title={!canLock ? "Only a Controller can lock the period" : undefined}>
            <Lock /> Lock {periodLabel(p.period)}
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setReopenOpen(true)} disabled={!canLock || !!pending}>
            <LockOpen /> Request reopen
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 md:grid-cols-3">
          {p.gates.map((g) => (
            <li key={g.key} className={cn("flex items-start gap-2 rounded-md border p-3", g.met ? "border-success/40" : "border-warning/50")}>
              {g.met ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <AlertOctagon className="mt-0.5 size-4 shrink-0 text-warning" />}
              <div className="text-sm">
                <p className="font-medium">{g.label}</p>
                <p className="text-xs text-muted-foreground">{g.detail}</p>
                {!g.met ? (
                  <Link to={g.link} className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline">
                    Resolve <ArrowRight className="size-3" />
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {!canLock ? (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" /> Only a Controller can lock or reopen a period.
          </p>
        ) : null}
        {p.reopenRequests.length ? (
          <div className="mt-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Reopen requests</p>
            <ul className="space-y-2">
              {p.reopenRequests
                .slice()
                .reverse()
                .map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                    <div>
                      <p>"{r.reason}"</p>
                      <p className="text-xs text-muted-foreground">
                        Requested by {name(r.requestedBy)} · {dateTimeLabel(r.requestedAt)}
                        {r.decidedBy ? ` · ${r.status} by ${name(r.decidedBy)}` : ""}
                      </p>
                    </div>
                    {r.status === "pending" ? (
                      can("period.reopen.approve", entityId) && r.requestedBy !== me.data?.user.id ? (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => decide.mutate({ id: r.id, decision: "reject" })}>
                            <XCircle /> Reject
                          </Button>
                          <Button size="sm" onClick={() => decide.mutate({ id: r.id, decision: "approve" })} loading={decide.isPending}>
                            <LockOpen /> Approve reopen
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="warning">{r.requestedBy === me.data?.user.id ? "Needs another controller's approval" : "Pending"}</Badge>
                      )
                    ) : (
                      <Badge variant={r.status === "approved" ? "success" : "destructive"}>{r.status}</Badge>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
      <ReasonDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title={`Reopen ${periodLabel(p.period)}?`}
        description="A second controller must approve the reopen. The reason is kept in the audit trail."
        minLength={10}
        confirmLabel="Request reopen"
        loading={request.isPending}
        onConfirm={(reason) => request.mutate(reason)}
      />
    </Card>
  );
}
