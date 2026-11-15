import { useCallback, useDeferredValue, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Download, FileDown, Link2, Lock, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "@/shared/api/client";
import { useAction, useCan, useEntities, useJob, useUserName } from "@/shared/api/hooks";
import type { AuditEvent, Job } from "@/shared/api/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input, Label, Select } from "@/shared/ui/input";
import { EmptyState, Skeleton, Tooltip } from "@/shared/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/shared/ui/table";
import { JobProgress, PageHeader } from "@/shared/ui/domain";
import { dateTimeLabel, relativeTime } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";

interface VerifyResult {
  ok: boolean;
  count: number;
  brokenAt?: number | string;
}
interface ExportResult {
  fileName: string;
  count: number;
  data: string;
}

/** Audit trail (US-22, US-24, NFR-Auditability). */
export default function AuditPage() {
  const can = useCan();
  const allowed = can("audit.view");
  const { data: entities } = useEntities();
  const userName = useUserName();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim());
  const [entityId, setEntityId] = useState("");
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; url: string; count: number } | null>(null);

  const events = useQuery({
    queryKey: ["audit-events", dq, entityId],
    queryFn: () => api.get<AuditEvent[]>(`/audit/events?${new URLSearchParams({ q: dq, entityId }).toString()}`),
    enabled: allowed,
    placeholderData: (prev) => prev,
  });

  const runVerify = useAction(() => api.get<VerifyResult>("/audit/verify"), { onSuccess: setVerify });
  const startExport = useAction(() => api.post<Job>("/audit/exports", { entityId: entityId || null }), {
    onSuccess: (j) => {
      setFile(null);
      setExportJobId(j.id);
    },
  });
  const onExportDone = useCallback((job: Job) => {
    if (job.status !== "succeeded" || !job.result) {
      toast.error(job.message || "Export failed");
      return;
    }
    const r = job.result as unknown as ExportResult;
    const url = URL.createObjectURL(new Blob([r.data], { type: "application/json" }));
    setFile((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { name: r.fileName, url, count: r.count };
    });
    toast.success(`Export ready: ${r.count} events`);
  }, []);
  const exportJob = useJob(exportJobId, onExportDone);
  const exporting = startExport.isPending || (!!exportJob && !["succeeded", "failed"].includes(exportJob.status));
  useEffect(() => () => void (file && URL.revokeObjectURL(file.url)), [file]);

  const entityName = (id: string | null) => (id ? entities?.find((e) => e.id === id)?.name ?? id : "—");

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Audit trail" />
        <EmptyState icon={<Lock className="size-6" />} title="You don't have access to the audit trail" description="Auditors and controllers can view it. Ask an admin if you need access." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Audit trail"
        eyebrow={<span>US-22 · US-24 · NFR-Auditability</span>}
        description="Every change, approval, AI output and sync is recorded here. Events are append-only and hash-chained: each one includes the hash of the one before, so any edit or deletion is detectable."
        actions={
          <>
            <Button variant="outline" onClick={() => runVerify.mutate(undefined)} loading={runVerify.isPending}>
              <ShieldCheck /> Verify hash chain
            </Button>
            <Button onClick={() => startExport.mutate(undefined)} loading={exporting} disabled={exporting}>
              <FileDown /> Export period
            </Button>
          </>
        }
      />

      <div className="mb-3 space-y-2">
        {verify ? (
          verify.ok ? (
            <div role="status" className="flex items-start gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <span>
                <span className="font-semibold">Chain intact.</span> All {verify.count.toLocaleString()} events link to the one before. Nothing was altered or removed.
              </span>
            </div>
          ) : (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <span>
                <span className="font-semibold">Chain broken at event #{verify.brokenAt}.</span> An event was changed or removed. Treat records after this point as unverified and contact support.
              </span>
            </div>
          )
        ) : null}
        <JobProgress job={exportJob} />
        {file ? (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
            <span>
              Export ready: <span className="font-mono text-xs">{file.name}</span> ({file.count.toLocaleString()} events)
            </span>
            <Button asChild size="sm" variant="outline">
              <a href={file.url} download={file.name}>
                <Download /> Download
              </a>
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="grid w-full gap-1.5 sm:w-72">
          <Label htmlFor="audit-q">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input id="audit-q" className="pl-8" placeholder="Action or summary" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="grid w-full gap-1.5 sm:w-64">
          <Label htmlFor="audit-entity">Entity</Label>
          <Select id="audit-entity" value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">All entities</option>
            {entities?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </div>
        {events.data ? (
          <p className="pb-2 text-xs text-muted-foreground" role="status">
            {events.data.length.toLocaleString()} event{events.data.length === 1 ? "" : "s"}
            {events.data.length >= 500 ? " (newest 500 shown)" : ""}
          </p>
        ) : null}
      </div>

      {events.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : events.isError ? (
        <EmptyState title="Couldn't load events" description="Try again in a moment." />
      ) : !events.data?.length ? (
        <EmptyState title="No events match" description="Try a different search or entity." />
      ) : (
        <Card className={cn(events.isFetching && "opacity-70 transition-opacity")}>
          <Table>
            <THead>
              <TR>
                <TH>Time</TH>
                <TH>Actor</TH>
                <TH>Action</TH>
                <TH className="min-w-[16rem]">Summary</TH>
                <TH className="hidden md:table-cell">Entity</TH>
                <TH>Hash</TH>
              </TR>
            </THead>
            <TBody>
              {events.data.map((ev) => (
                <TR key={ev.id}>
                  <TD className="whitespace-nowrap text-xs">
                    <time dateTime={ev.occurredAt} title={relativeTime(ev.occurredAt)}>
                      {dateTimeLabel(ev.occurredAt)}
                    </time>
                  </TD>
                  <TD className="whitespace-nowrap text-xs">
                    {ev.actorType === "ai" ? (
                      <Badge variant="ai">AI</Badge>
                    ) : ev.actorType === "system" ? (
                      <Badge variant="outline">System</Badge>
                    ) : (
                      userName(ev.actorId)
                    )}
                  </TD>
                  <TD>
                    <code className="whitespace-nowrap rounded bg-muted px-1 py-0.5 text-[11px]">{ev.action}</code>
                  </TD>
                  <TD className="text-xs">
                    {ev.summary}
                    {ev.subjectType === "je_draft" ? (
                      <Link to={`/audit/trace/${ev.subjectId}`} className="ml-1 inline-flex items-center gap-0.5 text-accent hover:underline">
                        <Link2 className="size-3" aria-hidden /> Trace
                      </Link>
                    ) : null}
                    <div className="mt-0.5 text-[11px] text-muted-foreground md:hidden">{entityName(ev.entityId)}</div>
                  </TD>
                  <TD className="hidden text-xs md:table-cell">{entityName(ev.entityId)}</TD>
                  <TD>
                    <Tooltip
                      content={
                        <span className="font-mono text-[11px]">
                          hash {ev.hash}
                          <br />
                          prev {ev.prevHash ?? "none (first event)"}
                        </span>
                      }
                    >
                      <code tabIndex={0} className="cursor-help font-mono text-[11px] text-muted-foreground" aria-label={`Hash ${ev.hash}, previous ${ev.prevHash ?? "none"}`}>
                        {ev.hash.slice(0, 10)}
                      </code>
                    </Tooltip>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
