import { CheckCircle2, ShieldCheck } from "lucide-react";
import type { Contract, GatingColumn } from "@/shared/api/types";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Amount } from "@/shared/ui/domain";
import { COLUMNS, columnMeta } from "./shared";

/** Gating queue Kanban (RR-4). Columns stack on small screens. */
export function GatingBoard({ contracts, onOpen, policyVersion }: { contracts: Contract[]; onOpen: (id: string) => void; policyVersion: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((col) => {
        const items = contracts.filter((c) => c.column === col);
        const headingId = `gating-col-${col}`;
        return (
          <section key={col} aria-labelledby={headingId} className="flex min-w-0 flex-col rounded-lg border bg-muted/40 p-2">
            <header className="mb-2 px-1">
              <div className="flex items-center justify-between gap-2">
                <h3 id={headingId} className="text-sm font-semibold">
                  {columnMeta[col].label}
                </h3>
                <span className="rounded-full bg-card px-2 text-xs font-semibold tabular text-muted-foreground" aria-label={`${items.length} items`}>
                  {items.length}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">{columnMeta[col].hint}</p>
            </header>
            {items.length === 0 ? (
              <p className="rounded-md border border-dashed px-2 py-4 text-center text-xs text-muted-foreground">Nothing here</p>
            ) : (
              <ul aria-labelledby={headingId} className="grid gap-2">
                {items.map((c) => (
                  <li key={c.id}>
                    <ContractCard c={c} col={col} onOpen={() => onOpen(c.id)} policyVersion={policyVersion} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ContractCard({ c, col, onOpen, policyVersion }: { c: Contract; col: GatingColumn; onOpen: () => void; policyVersion: number }) {
  const rec = c.recommendation.action;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-md border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open ${c.customer}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold">{c.customer}</span>
        <Amount value={c.monthly} currency={c.currency} className="text-sm font-semibold" />
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{c.code}</span>
        <span className="shrink-0">/ month</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
        <span className="truncate text-xs text-muted-foreground">{c.owner}</span>
        {col === "auto_applied" ? (
          <Badge variant={c.batchSignedOff ? "success" : "ai"}>
            {c.batchSignedOff ? <CheckCircle2 className="size-3" aria-hidden /> : <ShieldCheck className="size-3" aria-hidden />}
            {c.batchSignedOff ? "Signed off" : `Policy v${policyVersion}`}
          </Badge>
        ) : col === "needs_review" ? (
          <Badge variant={rec === "start" ? "info" : "warning"} title={c.recommendation.label}>
            AI: {rec === "start" ? "Start" : "Defer"}
          </Badge>
        ) : (
          <Badge variant={c.decision && c.decision.action !== c.recommendation.action ? "warning" : "outline"}>
            {c.decision && c.decision.action !== c.recommendation.action ? "Override" : "As recommended"}
          </Badge>
        )}
      </div>
      {c.decision?.action === "pulled_back" && col === "needs_review" ? (
        <p className={cn("mt-1.5 text-[11px] text-warning")}>Pulled back from auto-apply</p>
      ) : null}
    </button>
  );
}
