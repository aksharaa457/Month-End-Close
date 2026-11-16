import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, GitMerge, Lock, RefreshCw, Sparkles } from "lucide-react";
import type { EntityCloseSummary } from "@/shared/api/types";
import { useCloseSummary } from "@/shared/api/hooks";
import { closeDay, periodLabel, relativeTime } from "@/shared/lib/format";
import { closeStatusMeta } from "@/shared/lib/labels";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { PageHeader, ReleaseTag, StatCard } from "@/shared/ui/domain";
import { Progress, Skeleton } from "@/shared/ui/misc";
import { PageFallback } from "@/app/AppShell";

function Ring({ pct, tone }: { pct: number; tone: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="size-16 -rotate-90" aria-hidden>
      <circle cx="32" cy="32" r={r} className="fill-none stroke-muted" strokeWidth="6" />
      <circle cx="32" cy="32" r={r} className={cn("fill-none transition-all", tone)} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} />
    </svg>
  );
}

function EntityCard({ e }: { e: EntityCloseSummary }) {
  const meta = closeStatusMeta[e.status];
  const setup = e.status === "setup_required";
  const tone = e.status === "on_track" ? "stroke-success" : e.status === "needs_review" ? "stroke-warning" : "stroke-destructive";
  return (
    <Card className={cn("flex flex-col p-4", setup && "border-dashed bg-muted/30")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{e.entityName}</h3>
          <p className="text-xs text-muted-foreground">
            {e.region} · {e.erpType === "sap" ? "SAP" : "NetSuite"}
          </p>
        </div>
        {e.periodStatus === "locked" ? (
          <Badge variant="success">
            <Lock className="size-3" /> Locked
          </Badge>
        ) : (
          <Badge variant={meta.tone}>{meta.label}</Badge>
        )}
      </div>
      {setup ? (
        <div className="mt-4 flex flex-1 flex-col justify-between gap-3">
          <p className="text-sm text-muted-foreground">No ledger is connected yet, so this entity can't run its close in the app.</p>
          <Button asChild size="sm" variant="outline">
            <Link to={`/setup?tab=connections&entity=${e.entityId}`}>
              Set up <ArrowRight />
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-3">
            <div className="relative">
              <Ring pct={e.pctComplete} tone={e.periodStatus === "locked" ? "stroke-success" : tone} />
              <span className="absolute inset-0 grid place-items-center text-xs font-bold tabular">{Math.round(e.pctComplete)}%</span>
            </div>
            <dl className="grid flex-1 grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Tasks</dt>
              <dd className="text-right font-medium tabular">
                {e.tasksDone} / {e.tasksTotal}
              </dd>
              <dt className="text-muted-foreground">Overdue</dt>
              <dd className={cn("text-right font-medium tabular", e.tasksOverdue && "text-destructive")}>{e.tasksOverdue}</dd>
              <dt className="text-muted-foreground">Projected</dt>
              <dd className="text-right font-medium tabular">{closeDay(e.projectedCloseDay)}</dd>
              <dt className="text-muted-foreground">Target</dt>
              <dd className="text-right tabular">{closeDay(e.targetCloseDay)}</dd>
            </dl>
          </div>
          <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
            <RefreshCw className="size-3" /> Ledger synced {relativeTime(e.lastSyncAt)}
          </p>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link to={`/e/${e.entityId}/overview`}>
              View close <ArrowRight />
            </Link>
          </Button>
        </>
      )}
    </Card>
  );
}

export default function HubPage() {
  const q = useCloseSummary();
  if (q.isLoading) return <PageFallback />;
  if (!q.data) return null;
  const s = q.data;
  const f = s.forecast;
  const behind = f.varianceDays > 0;
  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <Building2 className="size-3.5" /> Northwind Holdings · {s.rollup.entities} entities
          </>
        }
        title={`Close status · ${periodLabel(s.period)}`}
        description="Live status of every entity's close. Click an entity to see its checklist, variances and entries."
      />

      {/* AI close forecast (HUB-3, v1) */}
      <Card className={cn("mb-5 overflow-hidden border-l-4 p-4", behind ? "border-l-destructive" : "border-l-success")}>
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-[10rem]">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ai">
              <Sparkles className="size-3.5" /> AI close forecast <ReleaseTag release="v1" />
            </p>
            <p className="mt-1 text-3xl font-bold tabular">{closeDay(f.projectedCloseDay)}</p>
            <p className={cn("text-sm font-medium", behind ? "text-destructive" : "text-success")}>
              {behind ? `+${f.varianceDays} days behind` : "On plan"} · plan {closeDay(f.planCloseDay)}
            </p>
          </div>
          <ul className="grid flex-1 gap-2 sm:grid-cols-2">
            {f.drags.map((d) => (
              <li key={d.label}>
                <Link to={d.link} className="flex items-start gap-2 rounded-md p-2 hover:bg-muted">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span>
                    <span className="block text-sm font-medium">{d.label}</span>
                    <span className="block text-xs text-muted-foreground">{d.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {/* Global roll-up (HUB-5) */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Global close"
          value={`${Math.round(s.rollup.pctComplete)}%`}
          sub={
            <span className="block">
              <Progress value={s.rollup.pctComplete} className="mt-1" />
            </span>
          }
        />
        <StatCard label="Tasks complete" value={`${s.rollup.tasksDone} / ${s.rollup.tasksTotal}`} sub="Across connected entities" icon={<CheckCircle2 className="size-4" />} />
        <StatCard label="Overdue tasks" value={s.rollup.tasksOverdue} tone={s.rollup.tasksOverdue ? "danger" : "success"} sub={`Today is ${closeDay(s.closeDay)}`} />
        <StatCard
          label="Entities locked"
          value={`${s.rollup.locked} / ${s.rollup.entities}`}
          sub={
            <Link to="/consolidation" className="inline-flex items-center gap-1 text-accent hover:underline">
              <GitMerge className="size-3" /> Consolidation: {s.consolidationStatus.replace("_", " ")} <ReleaseTag release="v1" />
            </Link>
          }
        />
      </div>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Entities</h2>
      {q.isFetching && !q.data ? <Skeleton className="h-40" /> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {s.entities.map((e) => (
          <EntityCard key={e.entityId} e={e} />
        ))}
      </div>
    </div>
  );
}
