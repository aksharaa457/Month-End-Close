import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Lock, PlayCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/shared/api/client";
import { useAction, useCan, useEntities, useJob } from "@/shared/api/hooks";
import type { ConsolidationView, Job } from "@/shared/api/types";
import { periodLabel } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { EmptyState, Skeleton } from "@/shared/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { JobProgress, PageHeader, ReleaseTag, StatCard } from "@/shared/ui/domain";
import { CONS_KEYS, EliminationsTab, IntercompanyTab, StatementsTab, TranslationTab } from "./ConsolidationTabs";

const statusMeta: Record<ConsolidationView["status"], { label: string; tone: "outline" | "warning" | "success" }> = {
  not_started: { label: "Not started", tone: "outline" },
  in_progress: { label: "In progress", tone: "warning" },
  locked: { label: "Locked", tone: "success" },
};

/** Group consolidation (F11, CO-1..CO-7). v1 module. */
export default function ConsolidationPage() {
  const qc = useQueryClient();
  const can = useCan();
  const canManage = can("consolidation.manage");
  const { data: view, isLoading, isError } = useQuery({ queryKey: ["consolidation"], queryFn: () => api.get<ConsolidationView>("/consolidation") });
  const { data: entities } = useEntities();
  const nameOf = useCallback((id: string) => entities?.find((e) => e.id === id)?.name ?? id, [entities]);

  const [jobId, setJobId] = useState<string | null>(null);
  const onJobDone = useCallback(
    (j: Job) => {
      CONS_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      if (j.status === "succeeded") toast.success("Currency translation complete");
      else toast.error(j.message || "Translation failed");
    },
    [qc],
  );
  const job = useJob(jobId, onJobDone);
  const running = !!job && (job.status === "queued" || job.status === "running");

  const translate = useAction(() => api.post<Job>("/consolidation/translation-run"), { onSuccess: (j) => setJobId(j.id) });
  const review = useAction(() => api.post<ConsolidationView>("/consolidation/review"), { invalidate: [["consolidation"]], success: "Consolidated review recorded" });
  const lock = useAction(() => api.post<ConsolidationView>("/consolidation/lock"), { invalidate: [["consolidation"]], success: "Consolidated period signed off and locked" });

  const stepsDone = useMemo(() => view?.steps.filter((s) => s.done).length ?? 0, [view]);

  const header = (
    <PageHeader
      eyebrow={
        <>
          <span>Group level</span>
          {view ? <span>· {periodLabel(view.period)}</span> : null}
        </>
      }
      title="Consolidation"
      description="Translate, match intercompany, eliminate and lock the consolidated period. Everything is in USD."
      actions={
        <div className="flex items-center gap-2">
          <ReleaseTag release="v1" />
          {view ? <Badge variant={statusMeta[view.status].tone}>{statusMeta[view.status].label}</Badge> : null}
        </div>
      }
    />
  );

  if (isLoading) {
    return (
      <div>
        {header}
        <div className="space-y-3">
          <Skeleton className="h-9 w-full max-w-lg" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }
  if (isError || !view) {
    return (
      <div>
        {header}
        <EmptyState title="Couldn't load consolidation" description="Try again in a moment." />
      </div>
    );
  }

  const locked = view.status === "locked";
  const translated = view.steps.find((s) => s.key === "translation")?.done ?? false;
  const reviewed = view.steps.find((s) => s.key === "review")?.done ?? false;
  const mismatches = view.matches.filter((m) => m.status === "mismatch").length;
  const proposedElims = view.eliminations.filter((e) => e.status === "proposed").length;

  return (
    <div className="min-w-0">
      {header}
      <Tabs defaultValue="overview">
        <TabsList aria-label="Consolidation sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="translation">Currency translation</TabsTrigger>
          <TabsTrigger value="ic">
            Intercompany {mismatches ? <Badge variant="destructive">{mismatches}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="elims">
            Eliminations {proposedElims ? <Badge variant="warning">{proposedElims}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="statements">Consolidated statements</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Checklist" value={`${stepsDone}/${view.steps.length}`} sub="steps done" tone={stepsDone === view.steps.length ? "success" : "default"} />
            <StatCard label="Entities" value={view.entityIds.length} sub="in scope" />
            <StatCard label="IC mismatches" value={mismatches} sub={`of ${view.matches.length} matches`} tone={mismatches ? "danger" : "success"} />
            <StatCard label="Eliminations pending" value={proposedElims} sub={`of ${view.eliminations.length}`} tone={proposedElims ? "warning" : "success"} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <Card>
              <CardHeader>
                <CardTitle>Consolidation checklist</CardTitle>
                <CardDescription>Work through the steps in order. The last step locks the consolidated period.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="relative">
                  {view.steps.map((s, i) => (
                    <li key={s.key} className="relative flex gap-3 pb-5 last:pb-0">
                      {i < view.steps.length - 1 ? <span aria-hidden className={cn("absolute left-[11px] top-7 h-[calc(100%-1.5rem)] w-px", s.done ? "bg-success/50" : "bg-border")} /> : null}
                      {s.done ? <CheckCircle2 className="size-6 shrink-0 text-success" aria-hidden /> : <Circle className="size-6 shrink-0 text-muted-foreground" aria-hidden />}
                      <div className="min-w-0 pt-0.5">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <span>
                            {i + 1}. {s.label}
                          </span>
                          <span className="sr-only">{s.done ? "(done)" : "(not done)"}</span>
                          {s.done ? <Badge variant="success">Done</Badge> : null}
                        </div>
                        <p className="text-xs text-muted-foreground">{s.detail}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Actions</CardTitle>
                <CardDescription>{canManage ? "You can run consolidation steps." : "You need the consolidation permission to run these steps."}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button className="w-full" variant="outline" disabled={!canManage || locked || running} loading={translate.isPending || running} onClick={() => translate.mutate(undefined)}>
                  <PlayCircle /> {translated ? "Re-run currency translation" : "Run currency translation"}
                </Button>
                <JobProgress job={job} />
                <Button className="w-full" variant="outline" disabled={!canManage || locked || reviewed || !translated} loading={review.isPending} onClick={() => review.mutate(undefined)}>
                  <ShieldCheck /> {reviewed ? "Consolidated review done" : "Mark consolidated review done"}
                </Button>
                {!translated && !reviewed ? <p className="text-[11px] text-muted-foreground">Run translation before the review.</p> : null}
                <Button className="w-full" disabled={!canManage || locked} loading={lock.isPending} onClick={() => lock.mutate(undefined)}>
                  <Lock /> {locked ? "Locked" : "Sign off & lock"}
                </Button>
                <p className="rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
                  Locking needs every checklist step done <strong>and</strong> every entity period locked first (CO-7). If anything is still open, the server refuses and tells you what is missing.
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="translation">
          <TranslationTab view={view} translated={translated} />
        </TabsContent>
        <TabsContent value="ic">
          <IntercompanyTab view={view} nameOf={nameOf} />
        </TabsContent>
        <TabsContent value="elims">
          <EliminationsTab view={view} canManage={canManage} locked={locked} />
        </TabsContent>
        <TabsContent value="statements">
          <StatementsTab view={view} nameOf={nameOf} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
