import { useState } from "react";
import { CheckCircle2, CircleSlash, ShieldCheck } from "lucide-react";
import { api } from "@/shared/api/client";
import { useAction, useCan } from "@/shared/api/hooks";
import type { AutoApplyPolicy, Contract } from "@/shared/api/types";
import { money } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Amount } from "@/shared/ui/domain";
import { PullBackDialog } from "./ContractDrawer";
import { checksPassed, recKey } from "./shared";

/** Auto-apply batch sign-off (RR-7, US-27). */
export function BatchSignOffPanel({ entityId, contracts, policy, onOpen }: { entityId: string; contracts: Contract[]; policy: AutoApplyPolicy; onOpen: (id: string) => void }) {
  const can = useCan();
  const canSign = can("je.approve", entityId);
  const canPull = can("recognition.decide", entityId);
  const [pulling, setPulling] = useState<Contract | null>(null);
  const invalidate = [recKey(entityId)];

  const items = contracts.filter((c) => c.column === "auto_applied" && !c.batchSignedOff);
  const signed = contracts.filter((c) => c.column === "auto_applied" && c.batchSignedOff);
  const total = items.reduce((x, c) => x + c.monthly, 0);
  const currency = items[0]?.currency ?? contracts[0]?.currency ?? "USD";

  const signOff = useAction(() => api.post<{ signedOff: number }>(`/entities/${entityId}/recognition/auto-apply-batch/sign-off`), {
    invalidate,
    success: (r) => `Signed off ${r.signedOff} auto-applied item${r.signedOff === 1 ? "" : "s"}`,
  });
  const pullBack = useAction((v: { id: string; reason: string }) => api.post<Contract>(`/contracts/${v.id}/pull-back`, { reason: v.reason }), {
    invalidate,
    success: (c) => `${c.customer} pulled back to review`,
    onSuccess: () => setPulling(null),
  });

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <ShieldCheck className="size-4 text-ai" aria-hidden /> Auto-apply batch sign-off
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Auto-applied items are pre-approved by policy v{policy.version}. Nothing posts until an approver signs off the batch. Pull back any item you want to review on its own first.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          {signed.length ? (
            <span className="inline-flex items-center gap-1 text-success">
              <CheckCircle2 className="size-3.5" aria-hidden /> {signed.length} item{signed.length === 1 ? "" : "s"} signed off this period.
            </span>
          ) : (
            "No auto-applied items are waiting for sign-off."
          )}
        </p>
      ) : (
        <>
          <ul className="mt-3 divide-y rounded-md border" aria-label="Items awaiting batch sign-off">
            {items.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                <button type="button" className="min-w-0 text-left" onClick={() => onOpen(c.id)}>
                  <div className="truncate text-sm font-medium hover:underline">{c.customer}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {checksPassed(c)}/{c.policyChecks.length} checks passed · policy v{policy.version}
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <Amount value={c.monthly} currency={c.currency} className="text-sm font-semibold" />
                  <Button size="sm" variant="ghost" disabled={!canPull} onClick={() => setPulling(c)} aria-label={`Pull back ${c.customer} to review`}>
                    <CircleSlash /> <span className="hidden sm:inline">Pull back</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm">
              Total <span className="font-semibold">{money(total, currency)}</span>
              <span className="text-xs text-muted-foreground"> · cap {money(policy.aggregateCap, currency)}</span>
            </div>
            <Button variant="success" disabled={!canSign} loading={signOff.isPending} onClick={() => signOff.mutate(undefined)}>
              <CheckCircle2 /> Sign off {items.length} item{items.length === 1 ? "" : "s"}
            </Button>
          </div>
          {!canSign ? <p className="mt-2 text-xs text-muted-foreground">Only an approver for this entity can sign off the batch.</p> : null}
        </>
      )}

      <PullBackDialog
        open={!!pulling}
        onOpenChange={(o) => !o && setPulling(null)}
        customer={pulling?.customer ?? ""}
        loading={pullBack.isPending}
        onConfirm={(reason) => pulling && pullBack.mutate({ id: pulling.id, reason })}
      />
    </Card>
  );
}
