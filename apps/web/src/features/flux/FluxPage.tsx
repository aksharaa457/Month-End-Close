import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, FilePlus2, Search, Sparkles } from "lucide-react";
import { api } from "@/shared/api/client";
import type { FluxView, Job, Variance } from "@/shared/api/types";
import { PERIOD, qk, useAction, useCan, useEntities, useJob } from "@/shared/api/hooks";
import { money, pct, periodLabel } from "@/shared/lib/format";
import { varianceStatusMeta } from "@/shared/lib/labels";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { JobProgress, PageHeader, StatCard } from "@/shared/ui/domain";
import { Input } from "@/shared/ui/input";
import { EmptyState, Switch, Tooltip } from "@/shared/ui/misc";
import { Label } from "@/shared/ui/input";
import { PageFallback } from "@/app/AppShell";
import { VarianceDrawer } from "./VarianceDrawer";

const GRID = "grid grid-cols-[minmax(0,1fr)_7.5rem] md:grid-cols-[minmax(0,2.2fr)_8rem_8rem_8rem_4.5rem_9.5rem] items-center gap-2";

export default function FluxPage() {
  const { entityId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const can = useCan();
  const entity = useEntities().data?.find((e) => e.id === entityId);
  const q = useQuery({ queryKey: qk.flux(entityId), queryFn: () => api.get<FluxView>(`/entities/${entityId}/periods/${PERIOD}/variances`) });
  const candidates = useQuery({
    queryKey: ["je-candidates", entityId],
    queryFn: () => api.get<{ varianceId: string }[]>(`/entities/${entityId}/periods/${PERIOD}/je-candidates`),
  });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const generate = useAction(() => api.post<Job>(`/entities/${entityId}/periods/${PERIOD}/je-drafts/generate`), { onSuccess: (j) => setJobId(j.id) });
  const job = useJob(jobId, (j) => {
    if (j.status === "succeeded") nav(`/e/${entityId}/journals?generated=${(j.result as { created?: number })?.created ?? 0}`);
  });

  const rows = useMemo(() => {
    const all = q.data?.variances ?? [];
    const term = search.trim().toLowerCase();
    if (flaggedOnly || term) {
      return all.filter((v) => (!flaggedOnly || v.isFlagged) && (!term || `${v.accountCode} ${v.accountName}`.toLowerCase().includes(term)));
    }
    const hidden = new Set<string>();
    const out: Variance[] = [];
    for (const v of all) {
      if (v.parentAccountId && (hidden.has(v.parentAccountId) || collapsed.has(v.parentAccountId))) {
        hidden.add(v.id);
        continue;
      }
      out.push(v);
    }
    return out;
  }, [q.data, collapsed, flaggedOnly, search]);

  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 44, overscan: 12 });

  if (q.isLoading) return <PageFallback />;
  if (!q.data) return null;
  if (entity?.status === "setup_required") return <EmptyState title="Entity not set up" description="Connect the ledger to see variances." />;
  const f = q.data;
  const selectedId = params.get("variance");
  const selected = f.variances.find((v) => v.id === selectedId) ?? null;
  const ccy = entity?.functionalCurrency ?? "USD";
  const nCandidates = candidates.data?.length ?? 0;
  const open = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("variance", id);
    else next.delete("variance");
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        eyebrow={entity?.name}
        title="P&L and balance sheet variance review"
        description={`${periodLabel(f.priorPeriod)} vs ${periodLabel(f.period)}. Lines over the materiality threshold are flagged and get an AI explanation with sources.`}
        actions={
          can("je.prepare", entityId) ? (
            <Button variant="ai" onClick={() => generate.mutate(undefined)} loading={generate.isPending || (!!job && job.status === "running")} disabled={nCandidates === 0}>
              <Sparkles /> Draft JEs for {nCandidates} flagged line{nCandidates === 1 ? "" : "s"}
            </Button>
          ) : null
        }
      />
      {job && job.status !== "succeeded" ? (
        <div className="mb-4">
          <JobProgress job={job} />
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Flagged lines" value={`${f.counts.flagged} / ${f.counts.total}`} tone="warning" />
        <StatCard label="Signed off" value={`${f.counts.signedOff} / ${f.counts.flagged}`} tone={f.counts.signedOff === f.counts.flagged ? "success" : "default"} />
        <StatCard
          label="Materiality"
          value={`${money(f.threshold.absAmount, ccy).replace(/\.00$/, "")} / ${f.threshold.pct}%`}
          sub={
            <>
              Whichever trips first · v{f.threshold.version}{" "}
              <Link to={`/setup?tab=thresholds&entity=${entityId}`} className="text-accent hover:underline">
                change
              </Link>
            </>
          }
        />
        <StatCard label="Need manual explanation" value={f.variances.filter((v) => v.status === "needs_manual").length} tone="danger" sub="AI had insufficient data" />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search account code or name" className="pl-8" aria-label="Search accounts" />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="flagged" checked={flaggedOnly} onCheckedChange={setFlaggedOnly} />
            <Label htmlFor="flagged">Flagged only</Label>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set())}>
              Expand all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set(f.variances.filter((v) => v.isGroup && v.depth >= 0).map((v) => v.id)))}>
              Collapse all
            </Button>
          </div>
        </div>

        <div role="treegrid" aria-label="Variance tree" aria-rowcount={rows.length} className="text-sm">
          <div role="row" className={cn(GRID, "border-b bg-muted/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground")}>
            <span role="columnheader">Account</span>
            <span role="columnheader" className="hidden text-right md:block">
              {periodLabel(f.priorPeriod)}
            </span>
            <span role="columnheader" className="hidden text-right md:block">
              {periodLabel(f.period)}
            </span>
            <span role="columnheader" className="text-right">
              Δ
            </span>
            <span role="columnheader" className="hidden text-right md:block">
              Δ%
            </span>
            <span role="columnheader" className="hidden text-right md:block">
              Status
            </span>
          </div>
          <div ref={parentRef} className="max-h-[65vh] overflow-y-auto">
            {rows.length === 0 ? <div className="p-6"><EmptyState title="No accounts match" /></div> : null}
            <div style={{ height: virt.getTotalSize(), position: "relative" }}>
              {virt.getVirtualItems().map((vi) => {
                const v = rows[vi.index];
                const meta = varianceStatusMeta[v.status];
                const isCollapsed = collapsed.has(v.id);
                const flat = flaggedOnly || !!search.trim();
                return (
                  <div
                    key={v.id}
                    role="row"
                    aria-level={v.depth + 1}
                    aria-expanded={v.isGroup && !flat ? !isCollapsed : undefined}
                    className={cn(GRID, "absolute left-0 right-0 border-b px-3 hover:bg-muted/40", v.isGroup && "bg-muted/20 font-semibold", selectedId === v.id && "bg-accent/10")}
                    style={{ top: vi.start, height: vi.size }}
                  >
                    <span role="gridcell" className="flex min-w-0 items-center gap-1" style={{ paddingLeft: flat ? 0 : v.depth * 16 }}>
                      {v.isGroup && !flat ? (
                        <button
                          className="rounded p-0.5 hover:bg-muted"
                          aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${v.accountName}`}
                          onClick={() =>
                            setCollapsed((s) => {
                              const n = new Set(s);
                              if (n.has(v.id)) n.delete(v.id);
                              else n.add(v.id);
                              return n;
                            })
                          }
                        >
                          {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                        </button>
                      ) : (
                        <span className="w-5 shrink-0" />
                      )}
                      {v.isFlagged ? <span className={cn("size-2 shrink-0 rounded-full", v.status === "signed_off" || v.status === "exception" ? "bg-success" : "bg-destructive")} aria-label="Flagged" /> : null}
                      <button className="min-w-0 truncate text-left hover:underline" onClick={() => open(v.id)}>
                        {!v.isGroup ? <span className="mr-1.5 text-xs text-muted-foreground tabular">{v.accountCode}</span> : null}
                        {v.accountName}
                      </button>
                      {v.draftIds.length ? (
                        <Tooltip content={`${v.draftIds.length} journal entr${v.draftIds.length > 1 ? "ies" : "y"} drafted`}>
                          <FilePlus2 className="size-3.5 shrink-0 text-accent" />
                        </Tooltip>
                      ) : null}
                    </span>
                    <span role="gridcell" className="hidden text-right tabular md:block">
                      {money(v.prior, ccy)}
                    </span>
                    <span role="gridcell" className="hidden text-right tabular md:block">
                      {money(v.current, ccy)}
                    </span>
                    <span role="gridcell" className={cn("text-right tabular", v.isFlagged && v.delta < 0 && "text-destructive")}>
                      {money(v.delta, ccy, { signed: true })}
                    </span>
                    <span role="gridcell" className={cn("hidden text-right tabular md:block", v.deltaPct === null && "text-muted-foreground")}>
                      {pct(v.deltaPct, 1, true)}
                    </span>
                    <span role="gridcell" className="hidden justify-end md:flex">
                      {v.isFlagged ? (
                        <button onClick={() => open(v.id)} className="max-w-full">
                          <Badge variant={meta.tone} className="max-w-full truncate">
                            {v.changedAfterSignoff ? "Changed after sign-off" : meta.label}
                          </Badge>
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <p className="border-t p-2 text-[11px] text-muted-foreground">
          {rows.length} rows shown · rows are virtualised, so large charts of accounts stay fast (NFR-Perf). "n/a" means the prior month was zero, so only the amount threshold applies.
        </p>
      </Card>

      <VarianceDrawer variance={selected} entityId={entityId} currency={ccy} onClose={() => open(null)} />
    </div>
  );
}
