import { useState, type ReactNode } from "react";
import { CheckCircle2, CircleSlash, FileCheck2, FileX2, Sparkles, Undo2, XCircle } from "lucide-react";
import { api } from "@/shared/api/client";
import { useAction, useCan, useUserName } from "@/shared/api/hooks";
import type { Contract } from "@/shared/api/types";
import { dateTimeLabel } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogDescription, DialogTitle, SheetContent } from "@/shared/ui/dialog";
import { Amount, ReasonDialog, SectionTitle } from "@/shared/ui/domain";
import { FieldError, Label, Textarea } from "@/shared/ui/input";
import { Progress } from "@/shared/ui/misc";
import { JUSTIFICATION_MIN, checksPassed, columnMeta, needsJustification, recKey } from "./shared";

/** Contract drawer (RR-5, RR-6) with policy checks (§10.1). */
export function ContractDrawer({ contract, entityId, policyVersion, onOpenChange }: { contract: Contract | null; entityId: string; policyVersion: number; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={!!contract} onOpenChange={onOpenChange}>
      <SheetContent>{contract ? <DrawerBody key={contract.id} c={contract} entityId={entityId} policyVersion={policyVersion} /> : null}</SheetContent>
    </Dialog>
  );
}

function DrawerBody({ c, entityId, policyVersion }: { c: Contract; entityId: string; policyVersion: number }) {
  const can = useCan();
  const userName = useUserName();
  const canDecide = can("recognition.decide", entityId);
  const invalidate = [recKey(entityId)];

  const [justification, setJustification] = useState("");
  const [tried, setTried] = useState<"start" | "defer" | null>(null);
  const [pullOpen, setPullOpen] = useState(false);

  const decide = useAction((v: { action: "start" | "defer"; justification: string }) => api.post<Contract>(`/contracts/${c.id}/decide`, v), {
    invalidate,
    success: (r) => (r.decision?.action === "defer" ? `${r.customer} deferred to Sep` : `${r.customer}: recognition starts in Aug`),
    onSuccess: () => setJustification(""),
  });
  const reset = useAction(() => api.post<Contract>(`/contracts/${c.id}/reset`), { invalidate, success: "Decision withdrawn" });
  const pullBack = useAction((reason: string) => api.post<Contract>(`/contracts/${c.id}/pull-back`, { reason }), {
    invalidate,
    success: `${c.customer} pulled back to review`,
    onSuccess: () => setPullOpen(false),
  });

  const trimmed = justification.trim();
  const submit = (action: "start" | "defer") => {
    if (needsJustification(c, action) && trimmed.length < JUSTIFICATION_MIN) {
      setTried(action);
      return;
    }
    decide.mutate({ action, justification: trimmed });
  };

  const passed = checksPassed(c);
  const allPassed = c.policyChecks.length > 0 && passed === c.policyChecks.length;
  const decided = c.decision && c.decision.action !== "pulled_back";
  const canDecideHere = c.column === "needs_review";
  const recIsStart = c.recommendation.action === "start";

  return (
    <>
      <div className="border-b p-4 pr-12">
        <div className="flex flex-wrap items-center gap-2">
          <DialogTitle className="text-lg font-semibold">{c.customer}</DialogTitle>
          <Badge variant={c.column === "needs_review" ? "warning" : c.column === "auto_applied" ? "ai" : c.column === "started" ? "success" : "outline"}>{columnMeta[c.column].label}</Badge>
        </div>
        <DialogDescription className="text-xs">{c.code}</DialogDescription>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Fact label="ARR">
            <Amount value={c.arr} currency={c.currency} />
          </Fact>
          <Fact label="Monthly">
            <Amount value={c.monthly} currency={c.currency} />
          </Fact>
          <Fact label="Owner">{c.owner}</Fact>
          <Fact label="Schedule">{c.scheduleVersion}</Fact>
          <Fact label="Trigger rule" className="col-span-2">
            <code className="break-all rounded bg-muted px-1 py-0.5 text-xs">{c.trigger}</code>
          </Fact>
        </dl>

        <section>
          <SectionTitle
            right={
              <Badge variant={c.evidenceFound ? "success" : "destructive"}>
                {c.evidenceFound ? "Evidence found" : "No trigger evidence"}
              </Badge>
            }
          >
            Source evidence
          </SectionTitle>
          <ul className="grid gap-1.5 text-sm">
            {c.evidence.map((e) => (
              <li key={e} className="flex items-start gap-2 rounded-md border bg-background p-2">
                {c.evidenceFound ? <FileCheck2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <FileX2 className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />}
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-ai/30 bg-ai-soft/60 p-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-ai">
              <Sparkles className="size-3.5" aria-hidden /> AI recommendation
            </span>
            <span className="text-xs text-muted-foreground">Confidence {c.confidence.toFixed(2)}</span>
          </div>
          <p className="text-sm font-semibold">{c.recommendation.label}</p>
          <p className="mt-1 text-sm">{c.recommendation.rationale}</p>
          <Progress value={c.confidence * 100} className="mt-2 h-1.5" indicatorClassName="bg-ai" aria-label="AI confidence" />
        </section>

        <section>
          <SectionTitle right={<span className="text-xs tabular text-muted-foreground">{passed}/{c.policyChecks.length} passed</span>}>Auto-apply policy checks · v{policyVersion}</SectionTitle>
          <p className="mb-2 text-xs text-muted-foreground">
            {c.column === "auto_applied"
              ? "Every check passed, so this item was pre-approved by policy. It still needs the batch sign-off before anything posts."
              : c.decision?.action === "pulled_back"
                ? "Pulled back from auto-apply by a person, so it is reviewed line by line."
                : allPassed
                  ? "All checks pass, but the item was decided manually or auto-apply is switched off."
                  : "At least one check failed, so this item can't be auto-applied and needs a person to decide."}
          </p>
          <ul className="grid gap-1.5" aria-label="Policy checks">
            {c.policyChecks.map((x) => (
              <li key={x.key} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                {x.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="Passed" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Failed" />}
                <div className="min-w-0 flex-1">
                  <div>{x.label}</div>
                  <div className="text-xs text-muted-foreground">{x.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {c.decision ? (
          <section className="rounded-lg border bg-muted/40 p-3 text-sm">
            <SectionTitle>{c.decision.action === "pulled_back" ? "Pulled back" : "Decision"}</SectionTitle>
            <p>
              <span className="font-semibold">
                {c.decision.action === "start" ? "Start in Aug" : c.decision.action === "defer" ? "Defer to Sep" : "Pulled back to review"}
              </span>{" "}
              by {userName(c.decision.by)} · {dateTimeLabel(c.decision.at)}
            </p>
            {c.decision.justification ? <p className="mt-1 text-muted-foreground">“{c.decision.justification}”</p> : null}
            {decided && c.decision.action !== c.recommendation.action ? <Badge variant="warning" className="mt-2">Overrides AI recommendation</Badge> : null}
          </section>
        ) : null}
      </div>

      <div className="space-y-3 border-t bg-card p-4">
        {!canDecide ? <p className="text-xs text-muted-foreground">You can view this contract. Deciding needs revenue-recognition access for this entity.</p> : null}

        {canDecideHere ? (
          <>
            <div className="grid gap-1.5">
              <Label htmlFor="rec-justification">
                Justification <span className="font-normal text-muted-foreground">(required to defer or to override the AI)</span>
              </Label>
              <Textarea
                id="rec-justification"
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="e.g. Signed order form received by email on 30 Aug; HubSpot not yet updated"
                disabled={!canDecide}
                className="min-h-16"
              />
              <FieldError>
                {tried && trimmed.length < JUSTIFICATION_MIN ? `${tried === "defer" ? "Deferrals" : "Overriding the AI recommendation"} needs a justification of at least ${JUSTIFICATION_MIN} characters.` : null}
              </FieldError>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant={recIsStart ? "outline" : "default"} disabled={!canDecide} loading={decide.isPending && decide.variables?.action === "defer"} onClick={() => submit("defer")}>
                Defer to Sep
              </Button>
              <Button variant={recIsStart ? "default" : "outline"} disabled={!canDecide} loading={decide.isPending && decide.variables?.action === "start"} onClick={() => submit("start")}>
                Start in Aug
              </Button>
            </div>
          </>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {c.decision && (decided || c.decision.action === "pulled_back") ? (
            <Button variant="ghost" size="sm" disabled={!canDecide} loading={reset.isPending} onClick={() => reset.mutate(undefined)}>
              <Undo2 /> Withdraw decision
            </Button>
          ) : null}
          {c.column === "auto_applied" && !c.batchSignedOff ? (
            <Button variant="outline" size="sm" disabled={!canDecide} onClick={() => setPullOpen(true)}>
              <CircleSlash /> Pull back to review
            </Button>
          ) : null}
          {c.column === "auto_applied" && c.batchSignedOff ? <p className={cn("text-xs text-success")}>Signed off in the auto-apply batch.</p> : null}
        </div>
      </div>

      <PullBackDialog open={pullOpen} onOpenChange={setPullOpen} customer={c.customer} loading={pullBack.isPending} onConfirm={(r) => pullBack.mutate(r)} />
    </>
  );
}

export function PullBackDialog({ open, onOpenChange, customer, loading, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; customer: string; loading: boolean; onConfirm: (reason: string) => void }) {
  return (
    <ReasonDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Pull back ${customer}`}
      description="The item leaves the auto-apply batch and goes to Needs review for a line-by-line decision."
      placeholder="e.g. Want to check the DocuSign envelope first"
      confirmLabel="Pull back"
      loading={loading}
      onConfirm={onConfirm}
    />
  );
}

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
