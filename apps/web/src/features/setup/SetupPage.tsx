import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  KeyRound,
  Lock,
  Plug,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users as UsersIcon,
} from "lucide-react";
import { api } from "@/shared/api/client";
import { PERIOD, qk, useAction, useCan, useEntities, useJob, useMe, useUserName, useUsers } from "@/shared/api/hooks";
import type {
  AccountClass,
  AccountMapping,
  ApprovalPolicy,
  Entity,
  ErpType,
  Job,
  Role,
  Source,
  StandardAccount,
  SyncRun,
  Threshold,
  User,
} from "@/shared/api/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { FieldError, Input, Label, Select } from "@/shared/ui/input";
import { Checkbox, EmptyState, Skeleton, Tooltip } from "@/shared/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Table, TBody, TD, TH, THead, TR } from "@/shared/ui/table";
import { Amount, JobProgress, PageHeader, ReleaseTag, SectionTitle } from "@/shared/ui/domain";
import { dateLabel, dateTimeLabel, money, periodLabel, relativeTime } from "@/shared/lib/format";
import { roleLabel } from "@/shared/lib/labels";
import { cn } from "@/shared/lib/utils";

// ------------------------------------------------------------------ shared bits

const TABS = ["connections", "mapping", "thresholds", "approvals", "users", "sources"] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABEL: Record<TabKey, string> = {
  connections: "Connections",
  mapping: "Account mapping",
  thresholds: "Thresholds",
  approvals: "Approvals",
  users: "Users & roles",
  sources: "Sources",
};

const ROLES = Object.keys(roleLabel) as Role[];
const CLASSES: AccountClass[] = ["asset", "liability", "equity", "revenue", "expense"];
const erpName = (t: ErpType) => (t === "sap" ? "SAP" : "NetSuite");

const sk = {
  syncRuns: (id: string) => ["sync-runs", id] as const,
  mappings: (id: string) => ["account-mappings", id] as const,
  std: ["standard-accounts"] as const,
  thresholds: (id: string) => ["thresholds", id] as const,
  policies: (id: string) => ["approval-policies", id] as const,
  sources: ["sources"] as const,
};

function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <p role="note" className="mb-3 flex items-start gap-2 rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function Prd({ ids }: { ids: string }) {
  return <span className="text-[11px] text-muted-foreground">{ids}</span>;
}

function TimeAgo({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="text-muted-foreground">never</span>;
  return (
    <Tooltip content={dateTimeLabel(iso)}>
      <time dateTime={iso} tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-2">
        {relativeTime(iso)}
      </time>
    </Tooltip>
  );
}

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

function EntityPicker({ entities, value, onChange, id = "entity-picker" }: { entities: Entity[]; value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <div className="grid w-full gap-1.5 sm:w-72">
      <Label htmlFor={id}>Entity</Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name} ({e.functionalCurrency})
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Disabled control with an explanation; disabled buttons don't fire pointer events, so wrap them. */
function Gate({ allowed, reason, children }: { allowed: boolean; reason: string; children: React.ReactElement }) {
  if (allowed) return children;
  return (
    <Tooltip content={reason}>
      <span tabIndex={0} className="inline-flex">
        {children}
      </span>
    </Tooltip>
  );
}

// ------------------------------------------------------------------ page

export default function SetupPage() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab: TabKey = (TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as TabKey) : "connections";
  const { data: entities, isLoading } = useEntities();
  const entityParam = params.get("entity");
  const entityId = entities?.some((e) => e.id === entityParam) ? entityParam! : entities?.find((e) => e.status === "active")?.id ?? entities?.[0]?.id ?? "";

  const setTab = (t: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("tab", t);
        return n;
      },
      { replace: true },
    );
  const setEntity = (id: string) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("entity", id);
        return n;
      },
      { replace: true },
    );

  return (
    <div>
      <PageHeader
        title="Setup & Enterprise Brain"
        eyebrow={<span>Admin · EB-1..EB-5, US-1..US-5</span>}
        description="Connect ledgers, map accounts to the standard chart, set materiality and approval rules, and manage who can do what."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Setup sections">
          {TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {TAB_LABEL[t]}
            </TabsTrigger>
          ))}
        </TabsList>
        {isLoading || !entities ? (
          <div className="mt-3">
            <TableSkeleton rows={4} />
          </div>
        ) : (
          <>
            <TabsContent value="connections">
              <ConnectionsTab entities={entities} />
            </TabsContent>
            <TabsContent value="mapping">
              <MappingTab entities={entities} entityId={entityId} setEntity={setEntity} />
            </TabsContent>
            <TabsContent value="thresholds">
              <ThresholdsTab entities={entities} entityId={entityId} setEntity={setEntity} />
            </TabsContent>
            <TabsContent value="approvals">
              <ApprovalsTab entities={entities} entityId={entityId} setEntity={setEntity} />
            </TabsContent>
            <TabsContent value="users">
              <UsersTab entities={entities} />
            </TabsContent>
            <TabsContent value="sources">
              <SourcesTab />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

// ------------------------------------------------------------------ connections (EB-1, EB-4, US-1)

function ConnectionsTab({ entities }: { entities: Entity[] }) {
  const can = useCan();
  const canSetup = can("setup.manage");
  const [wizardFor, setWizardFor] = useState<Entity | null>(null);
  return (
    <div className="space-y-3">
      {!canSetup ? <ReadOnlyNote>You can view connections. Only admins can connect ledgers; admins and controllers can trigger a sync.</ReadOnlyNote> : null}
      <p className="text-xs text-muted-foreground">
        Each entity's ledger syncs into the shared ledger model. Credentials live in Secrets Manager; we only show a masked reference. <Prd ids="EB-1, EB-4" />
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {entities.map((e) => (
          <EntityConnectionCard key={e.id} entity={e} canSetup={canSetup} canSync={canSetup || can("period.lock", e.id)} onSetup={() => setWizardFor(e)} />
        ))}
      </div>
      <ConnectWizard entity={wizardFor} onOpenChange={(o) => !o && setWizardFor(null)} />
    </div>
  );
}

function connectionBadge(e: Entity) {
  if (e.status === "setup_required") return <Badge variant="outline">Set up required</Badge>;
  if (e.connection.lastError) return <Badge variant="warning">Sync warning</Badge>;
  switch (e.connection.status) {
    case "connected":
      return <Badge variant="success">Connected</Badge>;
    case "error":
      return <Badge variant="destructive">Error</Badge>;
    case "disabled":
      return <Badge variant="outline">Disabled</Badge>;
    default:
      return <Badge variant="outline">Pending</Badge>;
  }
}

function useSyncJob(entityId: string, onSucceeded?: (job: Job) => void) {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const onDone = useCallback(
    (job: Job) => {
      qc.invalidateQueries({ queryKey: qk.entities });
      qc.invalidateQueries({ queryKey: qk.summary });
      qc.invalidateQueries({ queryKey: qk.notifications });
      qc.invalidateQueries({ queryKey: sk.syncRuns(entityId) });
      if (job.status === "succeeded") {
        toast.success(job.kind === "backfill" ? "Backfill finished" : "Sync finished");
        onSucceeded?.(job);
      } else toast.error(job.message || "Sync failed");
    },
    [qc, entityId, onSucceeded],
  );
  const job = useJob(jobId, onDone);
  const start = useAction((backfill: boolean) => api.post<Job>(`/entities/${entityId}/sync`, backfill ? { backfill: true } : {}), {
    onSuccess: (j) => setJobId(j.id),
  });
  const running = !!job && !["succeeded", "failed"].includes(job.status);
  return { job, start, running, reset: () => setJobId(null) };
}

function EntityConnectionCard({ entity: e, canSetup, canSync, onSetup }: { entity: Entity; canSetup: boolean; canSync: boolean; onSetup: () => void }) {
  const [open, setOpen] = useState(false);
  const sync = useSyncJob(e.id);
  const connected = e.connection.status === "connected";
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Database className="size-4 text-muted-foreground" aria-hidden />
              <span className="break-words">{e.name}</span>
            </CardTitle>
            <CardDescription>
              {e.region} · {erpName(e.erpType)} · {e.functionalCurrency}
            </CardDescription>
          </div>
          {connectionBadge(e)}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {e.connection.lastError ? (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            <span>
              <span className="font-semibold">Data may be stale.</span> {e.connection.lastError}
            </span>
          </div>
        ) : null}
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-2 sm:block">
            <dt className="text-muted-foreground">Last sync</dt>
            <dd>
              <TimeAgo iso={e.connection.lastSyncAt} />
            </dd>
          </div>
          <div className="flex min-w-0 justify-between gap-2 sm:block">
            <dt className="text-muted-foreground">Credential</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <KeyRound className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              {e.connection.secretRef ? (
                <span className="truncate font-mono text-[11px]" title="Masked Secrets Manager reference. The secret itself is never shown.">
                  {e.connection.secretRef}
                </span>
              ) : (
                <span className="text-muted-foreground">Not stored</span>
              )}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          {e.status === "setup_required" ? (
            <Gate allowed={canSetup} reason="Only admins can connect a ledger.">
              <Button size="sm" onClick={onSetup} disabled={!canSetup}>
                <Plug /> Set up
              </Button>
            </Gate>
          ) : null}
          {connected ? (
            <Gate allowed={canSync} reason="Only admins and controllers can trigger a sync.">
              <Button size="sm" variant="outline" onClick={() => sync.start.mutate(false)} disabled={!canSync || sync.running} loading={sync.start.isPending || sync.running}>
                <RefreshCw /> Sync now
              </Button>
            </Gate>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={`runs-${e.id}`}>
            {open ? <ChevronDown /> : <ChevronRight />} Recent syncs
          </Button>
        </div>
        <JobProgress job={sync.job} />
        {open ? (
          <div id={`runs-${e.id}`}>
            <SyncRuns entityId={e.id} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SyncRuns({ entityId }: { entityId: string }) {
  const { data, isLoading } = useQuery({ queryKey: sk.syncRuns(entityId), queryFn: () => api.get<SyncRun[]>(`/entities/${entityId}/sync-runs`) });
  if (isLoading) return <TableSkeleton rows={3} />;
  if (!data?.length) return <p className="text-xs text-muted-foreground">No sync runs yet.</p>;
  return (
    <Table className="text-xs">
      <THead>
        <TR>
          <TH>Started</TH>
          <TH>Trigger</TH>
          <TH>Status</TH>
          <TH className="text-right">Lines</TH>
        </TR>
      </THead>
      <TBody>
        {data.slice(0, 8).map((r) => (
          <TR key={r.id}>
            <TD>
              <TimeAgo iso={r.startedAt} />
            </TD>
            <TD className="capitalize">{r.trigger}</TD>
            <TD>
              <Badge variant={r.status === "succeeded" ? "success" : r.status === "failed" ? "destructive" : r.status === "partial" ? "warning" : "info"}>{r.status}</Badge>
              {r.error ? <p className="mt-0.5 text-destructive">{r.error}</p> : null}
            </TD>
            <TD className="tabular text-right">{r.stats.lines.toLocaleString()}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

const credsSchema = z.object({
  accountId: z.string().trim().min(3, "Enter the account ID (at least 3 characters)."),
  secret: z.string().trim().min(8, "Enter the integration token (at least 8 characters)."),
});
type Creds = z.infer<typeof credsSchema>;

function ConnectWizard({ entity, onOpenChange }: { entity: Entity | null; onOpenChange: (o: boolean) => void }) {
  const [step, setStep] = useState(1);
  const [erp, setErp] = useState<ErpType>("sap");
  const entityId = entity?.id ?? "";
  const form = useForm<Creds>({ resolver: zodResolver(credsSchema), defaultValues: { accountId: "", secret: "" } });
  const [done, setDone] = useState(false);
  const sync = useSyncJob(
    entityId,
    useCallback(() => setDone(true), []),
  );

  useEffect(() => {
    if (entity) {
      setStep(1);
      setErp(entity.erpType);
      setDone(false);
      form.reset({ accountId: "", secret: "" });
      sync.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity?.id]);

  const connect = useAction((v: Creds) => api.post<Entity>(`/entities/${entityId}/connections`, { erpType: erp, accountId: v.accountId, secret: v.secret }), {
    invalidate: [qk.entities],
    success: "Ledger connected. Credentials stored in Secrets Manager.",
    onSuccess: () => {
      form.reset({ accountId: "", secret: "" });
      setStep(3);
    },
  });

  const steps = ["Choose ERP", "Credentials", "Map accounts", "Backfill"];
  return (
    <Dialog open={!!entity} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect {entity?.name}</DialogTitle>
          <DialogDescription>Four steps. You can close this and come back; finished steps are saved.</DialogDescription>
        </DialogHeader>
        <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s} aria-current={step === i + 1 ? "step" : undefined} className={cn("flex items-center gap-1", step === i + 1 ? "font-semibold text-foreground" : step > i + 1 ? "text-success" : "text-muted-foreground")}>
              {step > i + 1 ? <CheckCircle2 className="size-3.5" aria-hidden /> : <span className="tabular">{i + 1}.</span>} {s}
            </li>
          ))}
        </ol>

        {step === 1 ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Which ledger does this entity use?</legend>
            {(["netsuite", "sap"] as ErpType[]).map((t) => (
              <label key={t} className={cn("flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm", erp === t && "border-primary bg-muted/40")}>
                <input type="radio" name="erp" value={t} checked={erp === t} onChange={() => setErp(t)} className="mt-1" />
                <span>
                  <span className="font-medium">{erpName(t)}</span>
                  <span className="block text-xs text-muted-foreground">{t === "sap" ? "S/4HANA via OData." : "SuiteTalk REST + SuiteQL."}</span>
                </span>
              </label>
            ))}
            <DialogFooter className="mt-2">
              <Button onClick={() => setStep(2)}>Continue</Button>
            </DialogFooter>
          </fieldset>
        ) : null}

        {step === 2 ? (
          <form className="grid gap-3" onSubmit={form.handleSubmit((v) => connect.mutate(v))} noValidate>
            <div className="grid gap-1.5">
              <Label htmlFor="cw-account">{erp === "sap" ? "SAP system / client ID" : "NetSuite account ID"}</Label>
              <Input id="cw-account" autoComplete="off" aria-invalid={!!form.formState.errors.accountId} {...form.register("accountId")} />
              <FieldError>{form.formState.errors.accountId?.message}</FieldError>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cw-secret">Integration token</Label>
              <Input id="cw-secret" type="password" autoComplete="new-password" aria-invalid={!!form.formState.errors.secret} {...form.register("secret")} />
              <FieldError>{form.formState.errors.secret?.message}</FieldError>
            </div>
            <p className="flex items-start gap-2 rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              The token goes straight to Secrets Manager. Nobody, including admins, can see it again; to change it, enter a new one.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button type="submit" loading={connect.isPending}>
                Connect
              </Button>
            </DialogFooter>
          </form>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-3 text-sm">
            <p>The connection works. Next, map this entity's accounts to the standard chart so the brain compares like with like.</p>
            <p className="text-xs text-muted-foreground">
              Unmapped accounts with a balance block the period lock. You can map them now or after the backfill, in{" "}
              <Link className="text-accent underline" to={`/setup?tab=mapping&entity=${entityId}`} onClick={() => onOpenChange(false)}>
                Account mapping
              </Link>
              . <Prd ids="US-2" />
            </p>
            <DialogFooter>
              <Button onClick={() => setStep(4)}>Continue to backfill</Button>
            </DialogFooter>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="grid gap-3 text-sm">
            <p>Load 13 months of balances and journal lines so variances have a prior period to compare against.</p>
            <JobProgress job={sync.job} />
            {done ? (
              <p role="status" className="flex items-center gap-2 text-success">
                <CheckCircle2 className="size-4" aria-hidden /> {entity?.name} is active and part of the close.
              </p>
            ) : null}
            <DialogFooter>
              {done ? (
                <Button onClick={() => onOpenChange(false)}>Finish</Button>
              ) : (
                <Button onClick={() => sync.start.mutate(true)} loading={sync.start.isPending || sync.running} disabled={sync.running}>
                  {sync.job?.status === "failed" ? "Retry backfill" : "Run backfill"}
                </Button>
              )}
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ mapping (US-2, EB-2)

const PAGE = 50;

function MappingTab({ entities, entityId, setEntity }: { entities: Entity[]; entityId: string; setEntity: (id: string) => void }) {
  const can = useCan();
  const canEdit = can("setup.manage", entityId);
  const entity = entities.find((e) => e.id === entityId);
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim().toLowerCase());
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [page, setPage] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);

  const mappings = useQuery({ queryKey: sk.mappings(entityId), queryFn: () => api.get<AccountMapping[]>(`/entities/${entityId}/account-mappings`), enabled: !!entityId });
  const std = useQuery({ queryKey: sk.std, queryFn: () => api.get<StandardAccount[]>("/standard-accounts"), staleTime: 5 * 60_000 });

  const stdByClass = useMemo(() => {
    const m = new Map<AccountClass, StandardAccount[]>();
    for (const s of std.data ?? []) m.set(s.accountClass, [...(m.get(s.accountClass) ?? []), s]);
    return m;
  }, [std.data]);

  const filtered = useMemo(
    () => (mappings.data ?? []).filter((m) => (!onlyUnmapped || !m.stdAccountId) && (!dq || `${m.erpCode} ${m.name}`.toLowerCase().includes(dq))),
    [mappings.data, onlyUnmapped, dq],
  );
  useEffect(() => setPage(0), [dq, onlyUnmapped, entityId]);

  const unmapped = (mappings.data ?? []).filter((m) => !m.stdAccountId);
  const blocking = unmapped.filter((m) => m.balance !== 0);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const rows = filtered.slice(page * PAGE, page * PAGE + PAGE);

  const save = useAction((v: { accountId: string; stdAccountId: string | null }) => api.put(`/entities/${entityId}/account-mappings`, v), {
    invalidate: [sk.mappings(entityId), qk.period(entityId)],
    success: "Mapping saved",
    onSuccess: () => setSavingId(null),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <EntityPicker entities={entities} value={entityId} onChange={setEntity} id="map-entity" />
        <div className="grid w-full gap-1.5 sm:w-64">
          <Label htmlFor="map-search">Search accounts</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input id="map-search" className="pl-8" placeholder="Code or name" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <Checkbox checked={onlyUnmapped} onCheckedChange={(v) => setOnlyUnmapped(v === true)} aria-label="Show unmapped only" />
          Unmapped only
        </label>
      </div>
      {!canEdit ? <ReadOnlyNote>You can view mappings. Only admins can change them.</ReadOnlyNote> : null}
      {mappings.data ? (
        <div
          role="status"
          className={cn("flex items-start gap-2 rounded-md border p-2.5 text-xs", blocking.length ? "border-warning/40 bg-warning/10" : "border-success/40 bg-success/10")}
        >
          {blocking.length ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />}
          <span>
            {blocking.length ? (
              <>
                <span className="font-semibold">{blocking.length} unmapped account{blocking.length === 1 ? "" : "s"} with a balance.</span> These block locking the {periodLabel(PERIOD)}{" "}
                period, because their amounts would be missing from the standard chart. {unmapped.length - blocking.length} more unmapped account(s) have no balance.
              </>
            ) : (
              <>All accounts with a balance are mapped. {unmapped.length ? `${unmapped.length} zero-balance account(s) are still unmapped.` : ""}</>
            )}{" "}
            <Prd ids="US-2, EB-2" />
          </span>
        </div>
      ) : null}
      {mappings.isLoading || std.isLoading ? (
        <TableSkeleton rows={8} />
      ) : !filtered.length ? (
        <EmptyState title="No accounts match" description={q ? "Try a different search." : "This entity has no accounts yet. Run a sync first."} />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Account</TH>
                <TH className="hidden sm:table-cell">Class</TH>
                <TH className="text-right">Balance</TH>
                <TH className="min-w-[14rem]">Standard account</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((m) => {
                const options = stdByClass.get(m.accountClass) ?? [];
                const sid = `map-${m.accountId}`;
                return (
                  <TR key={m.accountId} className={cn(!m.stdAccountId && "bg-warning/5")}>
                    <TD>
                      <div className="font-mono text-xs">{m.erpCode}</div>
                      <div className="text-xs text-muted-foreground">{m.name}</div>
                      {!m.stdAccountId ? (
                        <Badge variant={m.balance !== 0 ? "warning" : "outline"} className="mt-1">
                          Unmapped
                        </Badge>
                      ) : null}
                    </TD>
                    <TD className="hidden text-xs capitalize sm:table-cell">{m.accountClass}</TD>
                    <TD className="text-right text-xs">
                      <Amount value={m.balance} currency={entity?.functionalCurrency} />
                    </TD>
                    <TD>
                      <label htmlFor={sid} className="sr-only">
                        Standard account for {m.erpCode} {m.name}
                      </label>
                      <Select
                        id={sid}
                        value={m.stdAccountId ?? ""}
                        disabled={!canEdit || (save.isPending && savingId === m.accountId)}
                        onChange={(ev) => {
                          setSavingId(m.accountId);
                          save.mutate({ accountId: m.accountId, stdAccountId: ev.target.value || null });
                        }}
                        className="h-8 text-xs"
                      >
                        <option value="">Not mapped</option>
                        {options.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.code} {s.name}
                          </option>
                        ))}
                      </Select>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t p-2 text-xs text-muted-foreground">
            <span>
              {page * PAGE + 1}–{Math.min(filtered.length, page * PAGE + PAGE)} of {filtered.length}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ thresholds (FX-2, US-3)

const thresholdSchema = z.object({
  absAmount: z.coerce.number({ invalid_type_error: "Enter an amount." }).min(0, "Must be 0 or more."),
  pct: z.coerce.number({ invalid_type_error: "Enter a percentage." }).min(0, "Must be 0 or more.").max(100, "Must be 100 or less."),
  accountClass: z.string(),
});
type ThresholdForm = z.infer<typeof thresholdSchema>;

function ThresholdsTab({ entities, entityId, setEntity }: { entities: Entity[]; entityId: string; setEntity: (id: string) => void }) {
  const can = useCan();
  const canEdit = can("thresholds.manage", entityId);
  const userName = useUserName();
  const entity = entities.find((e) => e.id === entityId);
  const ccy = entity?.functionalCurrency ?? "USD";
  const { data, isLoading } = useQuery({ queryKey: sk.thresholds(entityId), queryFn: () => api.get<Threshold[]>(`/entities/${entityId}/thresholds`), enabled: !!entityId });
  const current = data?.find((t) => t.accountClass === null);
  const overrides = CLASSES.map((c) => data?.find((t) => t.accountClass === c)).filter((t): t is Threshold => !!t);

  const form = useForm<ThresholdForm>({ resolver: zodResolver(thresholdSchema), defaultValues: { absAmount: 0, pct: 10, accountClass: "" } });
  useEffect(() => {
    if (current) form.reset({ absAmount: current.absAmount, pct: current.pct, accountClass: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const create = useAction((v: ThresholdForm) => api.post<Threshold>(`/entities/${entityId}/thresholds`, { absAmount: v.absAmount, pct: v.pct, accountClass: v.accountClass || null }), {
    invalidate: [sk.thresholds(entityId), qk.flux(entityId)],
    success: (t) => `Threshold v${t.version} saved`,
  });

  return (
    <div className="space-y-4">
      <EntityPicker entities={entities} value={entityId} onChange={setEntity} id="thr-entity" />
      {!canEdit ? <ReadOnlyNote>You can view thresholds. Only controllers and admins can create a new version.</ReadOnlyNote> : null}
      <div className="grid gap-3 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Current materiality threshold</CardTitle>
              <CardDescription>
                A line is flagged when its change exceeds the amount <em>or</em> the percentage, whichever trips first. <Prd ids="FX-2" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : current ? (
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Amount</div>
                    <div className="text-xl font-bold">
                      <Amount value={current.absAmount} currency={ccy} />
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Percentage</div>
                    <div className="tabular text-xl font-bold">{current.pct}%</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    v{current.version} · effective {periodLabel(current.effectiveFrom)}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No default threshold set.</p>
              )}
              {overrides.length ? (
                <ul className="mt-3 space-y-1 text-xs">
                  {overrides.map((o) => (
                    <li key={o.id}>
                      <span className="capitalize">{o.accountClass}</span> override: {money(o.absAmount, ccy)} / {o.pct}% (v{o.version})
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
          <div>
            <SectionTitle>Version history</SectionTitle>
            <p className="mb-2 text-xs text-muted-foreground">Versions are never overwritten. Each flagged line records the threshold version that flagged it, so past reviews stay explainable.</p>
            {isLoading ? (
              <TableSkeleton rows={3} />
            ) : !data?.length ? (
              <EmptyState title="No versions yet" />
            ) : (
              <Card>
                <Table>
                  <THead>
                    <TR>
                      <TH>Version</TH>
                      <TH>Scope</TH>
                      <TH className="text-right">Amount</TH>
                      <TH className="text-right">%</TH>
                      <TH>Effective</TH>
                      <TH>Created</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.map((t) => (
                      <TR key={t.id}>
                        <TD className="tabular">v{t.version}</TD>
                        <TD className="capitalize">{t.accountClass ?? "Default"}</TD>
                        <TD className="text-right">
                          <Amount value={t.absAmount} currency={ccy} />
                        </TD>
                        <TD className="tabular text-right">{t.pct}%</TD>
                        <TD>{periodLabel(t.effectiveFrom)}</TD>
                        <TD className="text-xs">
                          {userName(t.createdBy)}
                          <div className="text-muted-foreground">{dateLabel(t.createdAt)}</div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>
            )}
          </div>
        </div>
        {canEdit ? (
          <Card>
            <CardHeader>
              <CardTitle>New version</CardTitle>
              <CardDescription>Takes effect from {periodLabel(PERIOD)}. Variances are recomputed.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
                <div className="grid gap-1.5">
                  <Label htmlFor="thr-abs">Amount ({ccy})</Label>
                  <Input id="thr-abs" type="number" inputMode="decimal" min={0} step="any" {...form.register("absAmount")} />
                  <FieldError>{form.formState.errors.absAmount?.message}</FieldError>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="thr-pct">Percentage</Label>
                  <Input id="thr-pct" type="number" inputMode="decimal" min={0} max={100} step="any" {...form.register("pct")} />
                  <FieldError>{form.formState.errors.pct?.message}</FieldError>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="thr-class">Applies to</Label>
                  <Select id="thr-class" {...form.register("accountClass")}>
                    <option value="">All accounts (default)</option>
                    {CLASSES.map((c) => (
                      <option key={c} value={c}>
                        {c[0].toUpperCase() + c.slice(1)} accounts only
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="submit" loading={create.isPending}>
                  Save new version
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ approvals (JE-4)

const policySchema = z.object({
  secondApprovalAbove: z.coerce.number({ invalid_type_error: "Enter an amount." }).min(0, "Must be 0 or more."),
});
type PolicyForm = z.infer<typeof policySchema>;

function ApprovalsTab({ entities, entityId, setEntity }: { entities: Entity[]; entityId: string; setEntity: (id: string) => void }) {
  const can = useCan();
  const canEdit = can("thresholds.manage", entityId);
  const entity = entities.find((e) => e.id === entityId);
  const { data, isLoading } = useQuery({ queryKey: sk.policies(entityId), queryFn: () => api.get<ApprovalPolicy[]>(`/entities/${entityId}/approval-policies`), enabled: !!entityId });
  const current = data?.[0];
  const ccy = current?.currency ?? entity?.functionalCurrency ?? "USD";
  const form = useForm<PolicyForm>({ resolver: zodResolver(policySchema), defaultValues: { secondApprovalAbove: 0 } });
  useEffect(() => {
    if (current) form.reset({ secondApprovalAbove: current.secondApprovalAbove });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);
  const save = useAction((v: PolicyForm) => api.post<ApprovalPolicy>(`/entities/${entityId}/approval-policies`, v), {
    invalidate: [sk.policies(entityId), qk.drafts(entityId)],
    success: (p) => `Approval policy v${p.version} saved`,
  });

  return (
    <div className="space-y-4">
      <EntityPicker entities={entities} value={entityId} onChange={setEntity} id="ap-entity" />
      {!canEdit ? <ReadOnlyNote>You can view the approval policy. Only controllers and admins can change it.</ReadOnlyNote> : null}
      <div className="grid gap-3 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Second approver</CardTitle>
              <CardDescription>
                Journal entries above this amount need a second, different approver before posting. The preparer can never approve their own entry. <Prd ids="JE-4" />
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-10 w-48" />
              ) : current ? (
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="text-xl font-bold">
                    <Amount value={current.secondApprovalAbove} currency={ccy} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    v{current.version} · effective {periodLabel(current.effectiveFrom)}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No policy set.</p>
              )}
            </CardContent>
          </Card>
          <div>
            <SectionTitle>History</SectionTitle>
            {isLoading ? (
              <TableSkeleton rows={2} />
            ) : !data?.length ? (
              <EmptyState title="No policy versions" />
            ) : (
              <Card>
                <Table>
                  <THead>
                    <TR>
                      <TH>Version</TH>
                      <TH className="text-right">Second approval above</TH>
                      <TH>Effective</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.map((p) => (
                      <TR key={p.id}>
                        <TD className="tabular">
                          v{p.version} {p.id === current?.id ? <Badge variant="success">Current</Badge> : null}
                        </TD>
                        <TD className="text-right">
                          <Amount value={p.secondApprovalAbove} currency={p.currency} />
                        </TD>
                        <TD>{periodLabel(p.effectiveFrom)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </Card>
            )}
          </div>
        </div>
        {canEdit ? (
          <Card>
            <CardHeader>
              <CardTitle>Change the limit</CardTitle>
              <CardDescription>Creates a new version from {periodLabel(PERIOD)}. Entries already approved keep the rule they were approved under.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-3" onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate>
                <div className="grid gap-1.5">
                  <Label htmlFor="ap-amount">Second approval above ({ccy})</Label>
                  <Input id="ap-amount" type="number" inputMode="decimal" min={0} step="any" {...form.register("secondApprovalAbove")} />
                  <FieldError>{form.formState.errors.secondApprovalAbove?.message}</FieldError>
                </div>
                <Button type="submit" loading={save.isPending}>
                  Save new version
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ users (EB-5, US-4, US-5)

function userStatusBadge(s: User["status"]) {
  return s === "active" ? <Badge variant="success">Active</Badge> : s === "invited" ? <Badge variant="info">Invited</Badge> : <Badge variant="outline">Deactivated</Badge>;
}

function UsersTab({ entities }: { entities: Entity[] }) {
  const can = useCan();
  const canEdit = can("setup.manage");
  const { data: me } = useMe();
  const { data: users, isLoading } = useUsers();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [deactivating, setDeactivating] = useState<User | null>(null);
  const entityName = (id: string | null) => (id ? entities.find((e) => e.id === id)?.name ?? id : "All entities");

  const deactivate = useAction((u: User) => api.post<User>(`/users/${u.id}/deactivate`), {
    invalidate: [qk.users],
    success: (u) => `${u.name} deactivated`,
    onSuccess: () => setDeactivating(null),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          People sign in through your identity provider. Roles can be scoped to one entity or all entities. <Prd ids="EB-5, US-4" />
        </p>
        {canEdit ? (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus /> Invite user
          </Button>
        ) : null}
      </div>
      {!canEdit ? <ReadOnlyNote>You can view users. Only admins can invite people or change roles.</ReadOnlyNote> : null}
      {isLoading ? (
        <TableSkeleton rows={6} />
      ) : !users?.length ? (
        <EmptyState icon={<UsersIcon className="size-6" />} title="No users" />
      ) : (
        <Card>
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Status</TH>
                <TH>Roles</TH>
                {canEdit ? <TH className="text-right">Actions</TH> : null}
              </TR>
            </THead>
            <TBody>
              {users.map((u) => {
                const self = u.id === me?.user.id;
                return (
                  <TR key={u.id} className={cn(u.status === "deactivated" && "opacity-60")}>
                    <TD>
                      <div className="font-medium">
                        {u.name} {self ? <span className="text-xs text-muted-foreground">(you)</span> : null}
                      </div>
                      <div className="break-all text-xs text-muted-foreground">{u.email}</div>
                      {u.title ? <div className="text-xs text-muted-foreground">{u.title}</div> : null}
                    </TD>
                    <TD>{userStatusBadge(u.status)}</TD>
                    <TD>
                      <ul className="flex flex-wrap gap-1">
                        {u.memberships.length ? (
                          u.memberships.map((m) => (
                            <li key={m.id}>
                              <Badge variant="outline" className="normal-case tracking-normal">
                                {roleLabel[m.role]} · {entityName(m.entityId)}
                              </Badge>
                            </li>
                          ))
                        ) : (
                          <li className="text-xs text-muted-foreground">No roles</li>
                        )}
                      </ul>
                    </TD>
                    {canEdit ? (
                      <TD className="text-right">
                        {u.status !== "deactivated" ? (
                          <div className="flex flex-wrap justify-end gap-1">
                            <Gate allowed={!self} reason="You can't change your own roles. Ask another admin.">
                              <Button size="sm" variant="outline" disabled={self} onClick={() => setEditing(u)}>
                                Edit roles
                              </Button>
                            </Gate>
                            <Gate allowed={!self} reason="You can't deactivate yourself.">
                              <Button size="sm" variant="ghost" disabled={self} onClick={() => setDeactivating(u)} aria-label={`Deactivate ${u.name}`}>
                                <UserMinus />
                              </Button>
                            </Gate>
                          </div>
                        ) : null}
                      </TD>
                    ) : null}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} entities={entities} />
      <EditRolesDialog user={editing} onOpenChange={(o) => !o && setEditing(null)} entities={entities} />
      <Dialog open={!!deactivating} onOpenChange={(o) => !o && setDeactivating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {deactivating?.name}?</DialogTitle>
            <DialogDescription>
              They lose access straight away and all their sessions are revoked, the same as a deprovisioning from your identity provider (SCIM). Their past work and audit history stay.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeactivating(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={deactivate.isPending} onClick={() => deactivating && deactivate.mutate(deactivating)}>
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const inviteSchema = z.object({
  name: z.string().trim().min(2, "Enter a name."),
  email: z.string().trim().email("Enter a valid email."),
  title: z.string().trim(),
  role: z.enum(["preparer", "reviewer", "approver", "controller", "admin", "auditor"]),
  entityId: z.string(),
});
type InviteForm = z.infer<typeof inviteSchema>;

function InviteDialog({ open, onOpenChange, entities }: { open: boolean; onOpenChange: (o: boolean) => void; entities: Entity[] }) {
  const form = useForm<InviteForm>({ resolver: zodResolver(inviteSchema), defaultValues: { name: "", email: "", title: "", role: "preparer", entityId: "" } });
  useEffect(() => {
    if (open) form.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const invite = useAction((v: InviteForm) => api.post<User>("/users", { ...v, entityId: v.entityId || null }), {
    invalidate: [qk.users],
    success: (u) => `Invitation sent to ${u.email}`,
    onSuccess: () => onOpenChange(false),
  });
  const err = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite user</DialogTitle>
          <DialogDescription>They become active the first time they sign in through SSO.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={form.handleSubmit((v) => invite.mutate(v))} noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="inv-name">Name</Label>
            <Input id="inv-name" autoComplete="off" {...form.register("name")} />
            <FieldError>{err.name?.message}</FieldError>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="inv-email">Work email</Label>
            <Input id="inv-email" type="email" autoComplete="off" {...form.register("email")} />
            <FieldError>{err.email?.message}</FieldError>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="inv-title">Job title (optional)</Label>
            <Input id="inv-title" autoComplete="off" {...form.register("title")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="inv-role">Role</Label>
              <Select id="inv-role" {...form.register("role")}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel[r]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="inv-entity">Scope</Label>
              <Select id="inv-entity" {...form.register("entityId")}>
                <option value="">All entities</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={invite.isPending}>
              Send invite
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditRolesDialog({ user, onOpenChange, entities }: { user: User | null; onOpenChange: (o: boolean) => void; entities: Entity[] }) {
  const [rows, setRows] = useState<{ key: number; entityId: string; role: Role }[]>([]);
  useEffect(() => {
    if (user) setRows(user.memberships.map((m, i) => ({ key: i, entityId: m.entityId ?? "", role: m.role })));
  }, [user]);
  const save = useAction(
    (v: { id: string; memberships: { entityId: string | null; role: Role }[] }) => api.put<User>(`/users/${v.id}/memberships`, { memberships: v.memberships }),
    { invalidate: [qk.users], success: (u) => `Roles updated for ${u.name}`, onSuccess: () => onOpenChange(false) },
  );
  const update = (key: number, patch: Partial<{ entityId: string; role: Role }>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit roles · {user?.name}</DialogTitle>
          <DialogDescription>Changes apply on their next request. Role changes are recorded in the audit trail.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">No roles. They will only be able to sign in.</p> : null}
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <div className="grid gap-1">
                <Label htmlFor={`er-role-${r.key}`}>Role {i + 1}</Label>
                <Select id={`er-role-${r.key}`} value={r.role} onChange={(e) => update(r.key, { role: e.target.value as Role })}>
                  {ROLES.map((x) => (
                    <option key={x} value={x}>
                      {roleLabel[x]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="col-span-1 grid gap-1 max-sm:order-3 max-sm:col-span-2">
                <Label htmlFor={`er-ent-${r.key}`}>Scope</Label>
                <Select id={`er-ent-${r.key}`} value={r.entityId} onChange={(e) => update(r.key, { entityId: e.target.value })}>
                  <option value="">All entities</option>
                  {entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="ghost" size="icon" aria-label={`Remove role ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => setRows((rs) => [...rs, { key: Math.max(-1, ...rs.map((x) => x.key)) + 1, entityId: "", role: "preparer" }])}
          >
            <Plus /> Add role
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => user && save.mutate({ id: user.id, memberships: rows.map((r) => ({ entityId: r.entityId || null, role: r.role })) })}
          >
            Save roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ sources (EB-3)

function SourcesTab() {
  const { data, isLoading } = useQuery({ queryKey: sk.sources, queryFn: () => api.get<Source[]>("/sources") });
  const groups = useMemo(() => {
    const m = new Map<string, Source[]>();
    for (const s of data ?? []) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return [...m.entries()];
  }, [data]);
  if (isLoading) return <TableSkeleton rows={6} />;
  if (!groups.length) return <EmptyState title="No sources available" />;
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Systems the Enterprise Brain can read from. Ledgers are in the MVP; other sources arrive in later releases. <Prd ids="EB-3" />
      </p>
      {groups.map(([cat, items]) => (
        <section key={cat} aria-labelledby={`src-${cat}`}>
          <SectionTitle>
            <span id={`src-${cat}`}>{cat}</span>
          </SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((s) => (
              <Card key={s.id} className="p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {s.name} <ReleaseTag release={s.release} />
                  </span>
                  {s.status === "connected" ? <Badge variant="success">Connected</Badge> : <Badge variant="outline">Available</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{s.details}</p>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
