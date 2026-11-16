import { useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ChevronRight, Paperclip, Sparkles } from "lucide-react";
import { api } from "@/shared/api/client";
import type { Task } from "@/shared/api/types";
import { PERIOD, qk, useEntities, useMe, useUserName } from "@/shared/api/hooks";
import { closeDay, periodLabel } from "@/shared/lib/format";
import { PHASES, phaseLabel, taskStatusMeta } from "@/shared/lib/labels";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Card } from "@/shared/ui/card";
import { PageHeader, StatCard } from "@/shared/ui/domain";
import { EmptyState, Progress } from "@/shared/ui/misc";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { PageFallback } from "@/app/AppShell";
import { TaskDrawer } from "./TaskDrawer";

type Filter = "all" | "mine" | "overdue" | "review";

export default function ChecklistPage() {
  const { entityId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("filter") as Filter) ?? "all";
  const taskId = params.get("task");
  const me = useMe();
  const name = useUserName();
  const entity = useEntities().data?.find((e) => e.id === entityId);
  const q = useQuery({ queryKey: qk.tasks(entityId), queryFn: () => api.get<Task[]>(`/entities/${entityId}/periods/${PERIOD}/tasks`) });

  const tasks = q.data ?? [];
  const uid = me.data?.user.id;
  const filtered = useMemo(
    () =>
      tasks.filter((t) =>
        filter === "mine" ? t.ownerId === uid || t.reviewerId === uid : filter === "overdue" ? t.overdue : filter === "review" ? t.status === "submitted" : true,
      ),
    [tasks, filter, uid],
  );

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  if (q.isLoading) return <PageFallback />;
  const done = tasks.filter((t) => t.status === "completed").length;
  const inProg = tasks.filter((t) => ["in_progress", "submitted", "rejected"].includes(t.status)).length;
  const notStarted = tasks.filter((t) => t.status === "not_started").length;
  const byAi = tasks.filter((t) => t.verifiedByAi).length;
  const selected = tasks.find((t) => t.id === taskId) ?? null;

  if (entity?.status === "setup_required")
    return (
      <div>
        <PageHeader title="Checklist" />
        <EmptyState title="Entity not set up" description="Connect this entity's ledger to start its close checklist." />
      </div>
    );

  return (
    <div>
      <PageHeader title={`Checklist · ${periodLabel(PERIOD)}`} eyebrow={entity?.name} description="Phased close tasks. The AI verifies what it can check from connected data and shows its reasoning; a different person signs off everything else." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total tasks" value={tasks.length} />
        <StatCard label="Completed" value={`${done} (${Math.round((done / Math.max(tasks.length, 1)) * 100)}%)`} tone="success" />
        <StatCard label="In progress" value={inProg} />
        <StatCard label="Verified by AI" value={byAi} tone="ai" sub={`${notStarted} not started`} icon={<Sparkles className="size-4 text-ai" />} />
      </div>

      <Tabs value={filter} onValueChange={(v) => set("filter", v === "all" ? null : v)} className="mb-3">
        <TabsList aria-label="Filter tasks">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="mine">Mine</TabsTrigger>
          <TabsTrigger value="overdue">Overdue ({tasks.filter((t) => t.overdue).length})</TabsTrigger>
          <TabsTrigger value="review">Awaiting sign-off ({tasks.filter((t) => t.status === "submitted").length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? <EmptyState title="No tasks match this filter" /> : null}

      <div className="space-y-4">
        {PHASES.map((ph) => {
          const items = filtered.filter((t) => t.phase === ph);
          if (!items.length) return null;
          const all = tasks.filter((t) => t.phase === ph);
          const allDone = all.filter((t) => t.status === "completed").length;
          return (
            <section key={ph} aria-labelledby={`ph-${ph}`}>
              <div className="mb-1.5 flex items-center gap-3">
                <h2 id={`ph-${ph}`} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {phaseLabel[ph]}
                </h2>
                <span className="text-xs text-muted-foreground tabular">
                  {allDone}/{all.length}
                </span>
                <Progress value={(allDone / all.length) * 100} className="h-1.5 max-w-32" />
              </div>
              <Card className="divide-y">
                {items.map((t) => {
                  const meta = taskStatusMeta[t.status];
                  return (
                    <button key={t.id} onClick={() => set("task", t.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 focus-visible:bg-muted/50">
                      {t.status === "completed" ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : t.overdue ? <AlertCircle className="size-4 shrink-0 text-destructive" /> : <span className="size-4 shrink-0 rounded-full border-2" />}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {t.title}
                          {t.verifiedByAi ? (
                            <Badge variant="ai">
                              <Sparkles className="size-3" /> Completed by AI
                            </Badge>
                          ) : null}
                          {t.isReconciliation ? <Badge variant="outline">Reconciliation</Badge> : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {name(t.ownerId)} → reviewer {name(t.reviewerId)} · due {closeDay(t.dueDay)}
                          {t.overdue ? <span className="font-medium text-destructive"> · overdue</span> : null}
                        </span>
                      </span>
                      {t.evidence.length ? (
                        <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
                          <Paperclip className="size-3.5" /> {t.evidence.length}
                        </span>
                      ) : null}
                      <Badge variant={meta.tone} className={cn("hidden sm:inline-flex")}>
                        {meta.label}
                      </Badge>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </button>
                  );
                })}
              </Card>
            </section>
          );
        })}
      </div>

      <TaskDrawer task={selected} allTasks={tasks} entityId={entityId} onClose={() => set("task", null)} />
    </div>
  );
}
