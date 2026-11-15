import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Bot, CheckCircle2, Database, ExternalLink, FileText, Lightbulb, ListTree, Lock, Send, TrendingUp, type LucideIcon } from "lucide-react";
import { api, ApiError, errorMessage } from "@/shared/api/client";
import { useCan, useEntities } from "@/shared/api/hooks";
import type { JeDraft, PeriodKey, TraceNode } from "@/shared/api/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { EmptyState, Skeleton } from "@/shared/ui/misc";
import { Amount, PageHeader } from "@/shared/ui/domain";
import { dateTimeLabel, periodLabel, relativeTime } from "@/shared/lib/format";
import { jeStatusMeta } from "@/shared/lib/labels";
import { cn } from "@/shared/lib/utils";

interface TraceResponse {
  draft: JeDraft;
  nodes: TraceNode[];
  period: PeriodKey;
}

const KIND: Record<TraceNode["kind"], { icon: LucideIcon; label: string; tone: string }> = {
  posting: { icon: Send, label: "Posting", tone: "bg-success/12 text-success" },
  approval: { icon: CheckCircle2, label: "Approval", tone: "bg-accent/12 text-accent" },
  draft: { icon: FileText, label: "Journal entry", tone: "bg-primary/10 text-primary" },
  ai_output: { icon: Bot, label: "AI output", tone: "bg-ai-soft text-ai" },
  variance: { icon: TrendingUp, label: "Variance", tone: "bg-warning/15 text-warning" },
  gl_line: { icon: ListTree, label: "GL line", tone: "bg-muted text-muted-foreground" },
  context_note: { icon: Lightbulb, label: "Context note", tone: "bg-ai-soft text-ai" },
  sync_run: { icon: Database, label: "Source sync", tone: "bg-muted text-muted-foreground" },
};

/** End-to-end trace of a journal entry back to source data (US-22). */
export default function TracePage() {
  const { draftId = "" } = useParams();
  const can = useCan();
  const allowed = can("audit.view");
  const { data: entities } = useEntities();
  const { data, isLoading, error } = useQuery({
    queryKey: ["trace", "je_draft", draftId],
    queryFn: () => api.get<TraceResponse>(`/trace/je_draft/${draftId}`),
    enabled: allowed && !!draftId,
    retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
  });

  const back = (
    <Button asChild variant="ghost" size="sm">
      <Link to="/audit">
        <ArrowLeft /> Audit trail
      </Link>
    </Button>
  );

  if (!allowed) {
    return (
      <div>
        <div className="mb-3">{back}</div>
        <EmptyState icon={<Lock className="size-6" />} title="You don't have access to audit traces" description="Auditors and controllers can view them." />
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-96 max-w-full" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div>
        <div className="mb-3">{back}</div>
        <EmptyState title="Couldn't load this trace" description={error ? errorMessage(error) : "The entry was not found."} />
      </div>
    );
  }

  const { draft, nodes, period } = data;
  const status = jeStatusMeta[draft.status];
  const entityName = entities?.find((e) => e.id === draft.entityId)?.name ?? draft.entityId;

  return (
    <div>
      <div className="mb-3">{back}</div>
      <PageHeader
        eyebrow={
          <>
            <span>Trace · US-22</span>
            <span aria-hidden>·</span>
            <span>{entityName}</span>
            <span aria-hidden>·</span>
            <span>{periodLabel(period)}</span>
          </>
        }
        title={`${draft.number} · ${draft.description}`}
        description="From the ERP posting back to the source data it came from. Newest step first."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to={`/e/${draft.entityId}/journals?draft=${draft.id}`}>
              <ExternalLink /> Open in journals
            </Link>
          </Button>
        }
      />
      <Card className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">Status</div>
          <Badge variant={status.tone}>{status.label}</Badge>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Amount</div>
          <Amount value={draft.totalDebit} currency={draft.currency} className="font-semibold" />
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Type</div>
          <span className="capitalize">{draft.type}</span>
        </div>
        {draft.erpDocNumber ? (
          <div>
            <div className="text-xs text-muted-foreground">ERP document</div>
            <span className="font-mono text-xs">{draft.erpDocNumber}</span>
          </div>
        ) : null}
        {draft.createdByAi ? <Badge variant="ai">AI drafted</Badge> : null}
        {draft.requiresSecondApproval ? <Badge variant="outline">Two approvals</Badge> : null}
      </Card>

      {nodes.length === 0 ? (
        <EmptyState title="No trace steps recorded" />
      ) : (
        <ol className="relative space-y-4" aria-label="Trace chain">
          {nodes.map((n, i) => {
            const meta = KIND[n.kind];
            const Icon = meta.icon;
            const last = i === nodes.length - 1;
            return (
              <li key={`${n.kind}-${n.id}`} className="relative flex gap-3">
                {!last ? <span aria-hidden className="absolute left-4 top-9 h-[calc(100%-1.25rem)] w-px bg-border" /> : null}
                <span className={cn("relative z-10 grid size-8 shrink-0 place-items-center rounded-full", meta.tone)} aria-hidden>
                  <Icon className="size-4" />
                </span>
                <Card className="min-w-0 flex-1 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{meta.label}</span>
                      <h2 className="break-words text-sm font-semibold">{n.title}</h2>
                    </div>
                    {n.at ? (
                      <time dateTime={n.at} title={dateTimeLabel(n.at)} className="text-xs text-muted-foreground">
                        {relativeTime(n.at)}
                      </time>
                    ) : null}
                  </div>
                  {n.detail ? <p className="mt-1 break-words text-sm text-muted-foreground">{n.detail}</p> : null}
                  {n.actor ? <p className="mt-1.5 text-xs text-muted-foreground">By {n.actor}</p> : null}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
