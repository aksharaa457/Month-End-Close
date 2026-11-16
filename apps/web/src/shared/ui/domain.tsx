import * as React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, BarChart3, Bot, FileText, Link2, Sparkles, Table2 } from "lucide-react";
import type { AiOutput, Citation } from "@/shared/api/types";
import { cn } from "@/shared/lib/utils";
import { dateTimeLabel, relativeTime } from "@/shared/lib/format";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card } from "./card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";
import { FieldError, Label, Textarea } from "./input";
import { Tooltip } from "./misc";

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{eyebrow}</div> : null}
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function ReleaseTag({ release }: { release: "MVP" | "v1" | "Later" }) {
  if (release === "MVP") return null;
  return (
    <Tooltip content={release === "v1" ? "Post-MVP v1 module (PRD §9.2)" : "Not yet scheduled"}>
      <span className="rounded border border-ai/40 px-1 text-[9px] font-bold uppercase tracking-wider text-ai">{release}</span>
    </Tooltip>
  );
}

export function StatCard({ label, value, sub, tone, icon }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "default" | "danger" | "success" | "warning" | "ai"; icon?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <div
        className={cn(
          "mt-1.5 text-2xl font-bold tabular tracking-tight",
          tone === "danger" && "text-destructive",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "ai" && "text-ai",
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </Card>
  );
}

export function Amount({ value, currency = "USD", className, signed }: { value: number; currency?: string; className?: string; signed?: boolean }) {
  const s = new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(Math.abs(value));
  return (
    <span className={cn("tabular whitespace-nowrap", value < 0 && "text-destructive", className)}>
      {value < 0 ? "-" : signed && value > 0 ? "+" : ""}
      {s}
    </span>
  );
}

export function CitationList({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Sources">
      {citations.map((c, i) => {
        const inner = (
          <>
            <Link2 className="size-3" aria-hidden />
            <span className="max-w-[16rem] truncate">{c.label}</span>
          </>
        );
        const cls = "inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground";
        return (
          <li key={`${c.recordId}-${i}`}>
            {c.link ? (
              <Link to={c.link} className={cls}>
                {inner}
              </Link>
            ) : (
              <span className={cls} title={`${c.recordType} · ${c.recordId}`}>
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Displays an AI output with its provenance (PRD §10 item 2, EB-4, EC-8/9). */
export function AiPanel({ output, title = "AI explanation", children, compact }: { output: AiOutput | null; title?: string; children?: React.ReactNode; compact?: boolean }) {
  if (!output) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5 font-medium">
          <Bot className="size-4" /> No AI output yet.
        </span>
      </div>
    );
  }
  const manual = output.modelId === "manual";
  const failed = output.outcome !== "ok";
  return (
    <div className={cn("rounded-lg border p-3", failed ? "border-destructive/40 bg-destructive/5" : manual ? "bg-muted/40" : "border-ai/30 bg-ai-soft/60")}>
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
        {failed ? (
          <span className="flex items-center gap-1 text-destructive">
            <AlertTriangle className="size-3.5" /> {output.outcome === "insufficient_data" ? "Insufficient data" : "AI unavailable"}
          </span>
        ) : manual ? (
          <span className="flex items-center gap-1 text-foreground">
            <FileText className="size-3.5" /> Manual explanation
          </span>
        ) : (
          <span className="flex items-center gap-1 text-ai">
            <Sparkles className="size-3.5" /> {title}
          </span>
        )}
        {output.contextNoteIds.length ? <Badge variant="ai">{output.contextNoteIds.length} context note(s) applied</Badge> : null}
      </div>
      <p className="whitespace-pre-line text-sm leading-relaxed">{output.text}</p>
      <CitationList citations={output.citations} />
      {!compact && !manual ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {output.modelId} · prompt {output.promptVersion} · confidence {output.confidence === null ? "n/a" : output.confidence.toFixed(2)} · region {output.inferenceRegion} · data as of{" "}
          <time dateTime={output.dataAsOf ?? undefined} title={dateTimeLabel(output.dataAsOf)}>
            {relativeTime(output.dataAsOf)}
          </time>
        </p>
      ) : null}
      {children}
    </div>
  );
}

/** Chart with a data-table fallback (NFR-A11y: every chart has a table). */
export function ChartCard({ title, description, chart, table, actions, className }: { title: string; description?: React.ReactNode; chart: React.ReactNode; table: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  const [asTable, setAsTable] = React.useState(false);
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex items-start justify-between gap-2 p-4 pb-1">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable} aria-label={asTable ? "Show chart" : "Show as table"}>
            {asTable ? <BarChart3 /> : <Table2 />}
            <span className="hidden sm:inline">{asTable ? "Chart" : "Table"}</span>
          </Button>
        </div>
      </div>
      <div className="flex-1 p-4 pt-2">{asTable ? table : chart}</div>
    </Card>
  );
}

/** Confirmation dialog that can require a written reason (justifications, rejections). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label = "Reason",
  minLength = 3,
  confirmLabel = "Confirm",
  destructive,
  loading,
  onConfirm,
  placeholder,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: React.ReactNode;
  label?: string;
  minLength?: number;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  placeholder?: string;
  children?: React.ReactNode;
}) {
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setReason("");
      setTouched(false);
    }
  }, [open]);
  const tooShort = reason.trim().length < minLength;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        {minLength > 0 ? (
          <div className="grid gap-1.5">
            <Label htmlFor="reason-input">{label}</Label>
            <Textarea id="reason-input" value={reason} placeholder={placeholder} onChange={(e) => setReason(e.target.value)} onBlur={() => setTouched(true)} autoFocus />
            <FieldError>{touched && tooShort ? `Write at least ${minLength} characters.` : null}</FieldError>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            loading={loading}
            onClick={() => {
              setTouched(true);
              if (!tooShort || minLength === 0) onConfirm(reason.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Initials({ name, className }: { name: string; className?: string }) {
  const init = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary", className)}>
      {init}
    </span>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 mt-1 flex items-center justify-between gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>
      {right}
    </div>
  );
}

export function JobProgress({ job }: { job: { status: string; progress: number; message: string } | null }) {
  if (!job) return null;
  return (
    <div role="status" aria-live="polite" className="rounded-md border bg-muted/40 p-3">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium">{job.status === "succeeded" ? "Done" : job.status === "failed" ? "Failed" : job.message}</span>
        <span className="tabular text-muted-foreground">{job.progress}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full transition-all", job.status === "failed" ? "bg-destructive" : "bg-primary")} style={{ width: `${job.progress}%` }} />
      </div>
      {job.status === "failed" ? <p className="mt-1.5 text-xs text-destructive">{job.message}</p> : null}
    </div>
  );
}
