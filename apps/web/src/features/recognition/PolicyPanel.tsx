import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AlertTriangle, Power, Settings2 } from "lucide-react";
import { api } from "@/shared/api/client";
import { useAction, useCan, useMe, useUserName } from "@/shared/api/hooks";
import type { AutoApplyPolicy } from "@/shared/api/types";
import { money } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { FieldError, Input, Label } from "@/shared/ui/input";
import { Progress, Switch } from "@/shared/ui/misc";
import { recKey } from "./shared";

type Limits = Pick<AutoApplyPolicy, "maxPerItem" | "maxPctOfRevenue" | "minConfidence" | "historyPeriods" | "aggregateCap">;

const schema = z
  .object({
    maxPerItem: z.coerce.number({ invalid_type_error: "Enter a number" }).min(0, "Can't be negative"),
    maxPctOfRevenue: z.coerce.number({ invalid_type_error: "Enter a number" }).min(0, "Can't be negative").max(100, "At most 100%"),
    minConfidence: z.coerce.number({ invalid_type_error: "Enter a number" }).min(0.8, "Minimum is 0.80").max(1, "Maximum is 1"),
    historyPeriods: z.coerce.number({ invalid_type_error: "Enter a number" }).int("Whole periods only").min(0, "Can't be negative").max(24, "At most 24"),
    aggregateCap: z.coerce.number({ invalid_type_error: "Enter a number" }).min(0, "Can't be negative"),
  })
  .refine((v) => v.aggregateCap >= v.maxPerItem, { path: ["aggregateCap"], message: "Must be at least the per-item limit" });

type FormValues = z.infer<typeof schema>;

/** Auto-apply policy (§10.1): kill switch, limits, two-person change, sampling. */
export function PolicyPanel({ entityId, policy, currency }: { entityId: string; policy: AutoApplyPolicy; currency: string }) {
  const can = useCan();
  const canManage = can("recognition.policy", entityId);
  const me = useMe().data;
  const userName = useUserName();
  const [proposing, setProposing] = useState(false);
  const invalidate = [recKey(entityId)];
  const base = `/entities/${entityId}/recognition/policy`;

  const kill = useAction((enabled: boolean) => api.post<AutoApplyPolicy>(`${base}/kill-switch`, { enabled }), {
    invalidate,
    success: (p) => (p.enabled ? "Auto-apply switched on" : "Auto-apply switched off"),
  });
  const propose = useAction((v: FormValues) => api.post<AutoApplyPolicy>(`${base}/propose`, v), {
    invalidate,
    success: "Change proposed. A second controller must approve it.",
    onSuccess: () => setProposing(false),
  });
  const approve = useAction(() => api.post<AutoApplyPolicy>(`${base}/approve`), { invalidate, success: (p) => `Policy v${p.version} is now in effect` });
  const discard = useAction(() => api.post<AutoApplyPolicy>(`${base}/discard`), { invalidate, success: "Pending change discarded" });
  const sample = useAction((error: boolean) => api.post<AutoApplyPolicy>(`${base}/sample`, { error }), {
    invalidate,
    success: (p) => (p.enabled ? "Sample recorded" : "Sample recorded. Auto-apply is now off."),
  });

  const pc = policy.pendingChange;
  const iProposed = !!(pc && me && pc.approvals.includes(me.user.id));
  const s = policy.sampling;
  const sampleDone = s.checked >= s.sampleSize;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Settings2 className="size-4 text-muted-foreground" aria-hidden /> Auto-apply policy
            <Badge variant="outline">v{policy.version}</Badge>
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">An item is auto-applied only if every check passes. Changes need a controller and a second approver.</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="auto-apply-switch" className={cn("text-xs", policy.enabled ? "text-success" : "text-destructive")}>
            {policy.enabled ? "On" : "Off"}
          </Label>
          <Switch
            id="auto-apply-switch"
            checked={policy.enabled}
            disabled={!canManage || kill.isPending}
            onCheckedChange={(v) => kill.mutate(v)}
            aria-label="Auto-apply enabled (kill switch)"
          />
        </div>
      </div>

      {!policy.enabled ? (
        <p className="mt-3 flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
          <Power className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Auto-apply is off. Every item goes to Needs review.
        </p>
      ) : null}

      <LimitsList limits={policy} currency={currency} />

      {pc ? (
        <div className="mt-4 rounded-md border border-warning/40 bg-warning/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Pending change · v{pc.version}</p>
            <span className="text-xs text-muted-foreground">Proposed by {userName(pc.proposedBy)}</span>
          </div>
          <LimitsList limits={pc} currency={currency} compareTo={policy} />
          {iProposed ? (
            <p className="mt-2 text-xs text-muted-foreground">
              You proposed this change, so someone else must approve it. Sign in as a second controller, e.g. Grace Okafor (CFO).
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" disabled={!canManage} loading={discard.isPending} onClick={() => discard.mutate(undefined)}>
              Discard
            </Button>
            <Button size="sm" disabled={!canManage || iProposed} loading={approve.isPending} onClick={() => approve.mutate(undefined)}>
              Approve change
            </Button>
          </div>
        </div>
      ) : proposing ? (
        <ProposeForm policy={policy} loading={propose.isPending} onCancel={() => setProposing(false)} onSubmit={(v) => propose.mutate(v)} />
      ) : (
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="outline" disabled={!canManage} onClick={() => setProposing(true)}>
            Propose change
          </Button>
        </div>
      )}

      <div className="mt-5 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Sampling this period</h4>
          <span className={cn("text-xs font-semibold tabular", s.errorRatePct > 2 ? "text-destructive" : "text-success")}>{s.errorRatePct.toFixed(1)}% errors</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          An approver re-checks a random sample of auto-applied items. An error rate above 2% switches auto-apply off until the Controller reviews it.
        </p>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-md bg-muted/60 p-2">
            <dt className="text-[11px] text-muted-foreground">Sample size</dt>
            <dd className="font-semibold tabular">{s.sampleSize}</dd>
          </div>
          <div className="rounded-md bg-muted/60 p-2">
            <dt className="text-[11px] text-muted-foreground">Checked</dt>
            <dd className="font-semibold tabular">{s.checked}</dd>
          </div>
          <div className="rounded-md bg-muted/60 p-2">
            <dt className="text-[11px] text-muted-foreground">Errors</dt>
            <dd className={cn("font-semibold tabular", s.errors > 0 && "text-destructive")}>{s.errors}</dd>
          </div>
        </dl>
        <Progress value={s.sampleSize ? (s.checked / s.sampleSize) * 100 : 0} className="mt-2" aria-label="Sample progress" />
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" disabled={!canManage || sampleDone} loading={sample.isPending && sample.variables === false} onClick={() => sample.mutate(false)}>
            Record sample: correct
          </Button>
          <Button size="sm" variant="outline" className="text-destructive" disabled={!canManage || sampleDone} loading={sample.isPending && sample.variables === true} onClick={() => sample.mutate(true)}>
            <AlertTriangle /> Record sample: error
          </Button>
        </div>
        {sampleDone ? <p className="mt-1 text-right text-xs text-muted-foreground">Sample complete for this period.</p> : null}
      </div>

      {!canManage ? <p className="mt-3 text-xs text-muted-foreground">Only a controller can change the policy, use the kill switch or record samples.</p> : null}
    </Card>
  );
}

function LimitsList({ limits, currency, compareTo }: { limits: Limits; currency: string; compareTo?: Limits }) {
  const rows: { key: keyof Limits; label: string; fmt: (v: number) => string }[] = [
    { key: "maxPerItem", label: "Max per item", fmt: (v) => money(v, currency) },
    { key: "maxPctOfRevenue", label: "Max % of monthly revenue", fmt: (v) => `${v}%` },
    { key: "minConfidence", label: "Min AI confidence", fmt: (v) => v.toFixed(2) },
    { key: "historyPeriods", label: "Clean history (periods)", fmt: (v) => String(v) },
    { key: "aggregateCap", label: "Aggregate cap per period", fmt: (v) => money(v, currency) },
  ];
  return (
    <dl className="mt-3 grid gap-1 text-sm">
      {rows.map((r) => {
        const changed = compareTo && compareTo[r.key] !== limits[r.key];
        return (
          <div key={r.key} className="flex flex-wrap items-baseline justify-between gap-x-3">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className={cn("tabular font-medium", changed && "text-warning")}>
              {changed && compareTo ? <span className="mr-1.5 text-xs text-muted-foreground line-through">{r.fmt(compareTo[r.key])}</span> : null}
              {r.fmt(limits[r.key])}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function ProposeForm({ policy, loading, onCancel, onSubmit }: { policy: AutoApplyPolicy; loading: boolean; onCancel: () => void; onSubmit: (v: FormValues) => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      maxPerItem: policy.maxPerItem,
      maxPctOfRevenue: policy.maxPctOfRevenue,
      minConfidence: policy.minConfidence,
      historyPeriods: policy.historyPeriods,
      aggregateCap: policy.aggregateCap,
    },
  });
  const field = (name: keyof FormValues, label: string, step: string) => (
    <div className="grid gap-1">
      <Label htmlFor={`policy-${name}`}>{label}</Label>
      <Input id={`policy-${name}`} type="number" inputMode="decimal" step={step} aria-invalid={!!errors[name]} {...register(name)} />
      <FieldError>{errors[name]?.message}</FieldError>
    </div>
  );
  return (
    <form className="mt-4 grid gap-3 rounded-md border p-3" onSubmit={handleSubmit(onSubmit)} noValidate>
      <p className="text-sm font-semibold">Propose a change · v{policy.version + 1}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("maxPerItem", "Max per item", "100")}
        {field("maxPctOfRevenue", "Max % of monthly revenue", "0.1")}
        {field("minConfidence", "Min AI confidence (0.80–1)", "0.01")}
        {field("historyPeriods", "Clean history (periods)", "1")}
        {field("aggregateCap", "Aggregate cap per period", "1000")}
      </div>
      <p className="text-xs text-muted-foreground">The change takes effect only after a second controller approves it.</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={loading}>
          Propose
        </Button>
      </div>
    </form>
  );
}
