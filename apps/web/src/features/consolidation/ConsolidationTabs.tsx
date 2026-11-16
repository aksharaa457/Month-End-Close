import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, Check, FileEdit, Info, Sparkles } from "lucide-react";
import { api } from "@/shared/api/client";
import { useAction, useCan, useMe, useUserName } from "@/shared/api/hooks";
import type { ConsolidatedLine, ConsolidationView, Elimination, IcMatch, JeDraft } from "@/shared/api/types";
import { moneyCompact } from "@/shared/lib/format";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { EmptyState } from "@/shared/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/shared/ui/table";
import { Amount, ChartCard } from "@/shared/ui/domain";

type Tone = "default" | "success" | "warning" | "destructive" | "info" | "ai" | "outline";
type NameOf = (id: string) => string;

export const CONS_KEYS = [["consolidation"], ["drafts"]];

function Note({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "warning" | "ai" }) {
  return (
    <div
      className={cn(
        "flex gap-2 rounded-md border p-3 text-xs leading-relaxed",
        tone === "muted" && "bg-muted/40 text-muted-foreground",
        tone === "warning" && "border-warning/40 bg-warning/5 text-foreground",
        tone === "ai" && "border-ai/30 bg-ai-soft/60 text-foreground",
      )}
    >
      <Info className={cn("mt-0.5 size-3.5 shrink-0", tone === "warning" && "text-warning", tone === "ai" && "text-ai")} aria-hidden />
      <div>{children}</div>
    </div>
  );
}

// ------------------------------------------------------------------ translation (CO-2)
export function TranslationTab({ view, translated }: { view: ConsolidationView; translated: boolean }) {
  return (
    <div className="space-y-4">
      <Note>
        Translation follows ASC 830: balance-sheet items use the <strong>closing</strong> rate, P&amp;L items use the period <strong>average</strong> rate, and opening equity stays at <strong>historical</strong> rates. The difference that leaves is the cumulative translation adjustment (CTA), booked to OCI.
      </Note>
      {!translated ? (
        <Note tone="warning">Translation hasn&apos;t been run for this period yet. The USD figures below are a preview at current rates. Run it from the Overview tab.</Note>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>FX rates</CardTitle>
          <CardDescription>Rates to USD for {view.period}.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {view.rates.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No FX rates" description="All entities report in USD." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Currency</TH>
                  <TH className="text-right">Closing</TH>
                  <TH className="text-right">Average</TH>
                  <TH>Source</TH>
                </TR>
              </THead>
              <TBody>
                {view.rates.map((r) => (
                  <TR key={r.ccy}>
                    <TD className="font-medium">{r.ccy}</TD>
                    <TD className="text-right tabular">{r.closing.toFixed(6)}</TD>
                    <TD className="text-right tabular">{r.average.toFixed(6)}</TD>
                    <TD className="text-muted-foreground">{r.source}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Translation by entity</CardTitle>
          <CardDescription>Local currency figures and their USD translation.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {view.translation.length === 0 ? (
            <div className="p-4">
              <EmptyState title="No active entities" />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Entity</TH>
                  <TH>Line</TH>
                  <TH className="text-right">Local</TH>
                  <TH>Rate used</TH>
                  <TH className="text-right">USD</TH>
                </TR>
              </THead>
              <TBody>
                {view.translation.map((t) => {
                  const rows: [string, number, number, string][] = [
                    ["Assets", t.assets, t.assetsUsd, "Closing"],
                    ["Liabilities", t.liabilities, t.liabilitiesUsd, "Closing"],
                    ["Equity", t.equity, t.equityUsd, "Historical + NI at average"],
                    ["Net income", t.netIncome, t.netIncomeUsd, "Average"],
                  ];
                  return [
                    ...rows.map(([label, local, usd, rate], i) => (
                      <TR key={`${t.entityId}-${label}`} className={cn(i === 0 && "border-t-2")}>
                        {i === 0 ? (
                          <TD rowSpan={5} className="align-top font-medium">
                            {t.entityName}
                            <div className="text-xs font-normal text-muted-foreground">{t.ccy}</div>
                          </TD>
                        ) : null}
                        <TD>{label}</TD>
                        <TD className="text-right">
                          <Amount value={local} currency={t.ccy} />
                        </TD>
                        <TD className="text-xs text-muted-foreground">{t.ccy === "USD" ? "1.0" : rate}</TD>
                        <TD className="text-right">
                          <Amount value={usd} />
                        </TD>
                      </TR>
                    )),
                    <TR key={`${t.entityId}-cta`} className="bg-muted/30">
                      <TD className="font-medium">CTA (to OCI)</TD>
                      <TD className="text-right text-muted-foreground">—</TD>
                      <TD className="text-xs text-muted-foreground">Balancing</TD>
                      <TD className="text-right font-semibold">
                        <Amount value={t.cta} />
                      </TD>
                    </TR>,
                  ];
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ intercompany (CO-3, CO-4)
const matchMeta: Record<IcMatch["status"], { label: string; tone: Tone }> = {
  matched: { label: "Matched", tone: "success" },
  mismatch: { label: "Mismatch", tone: "destructive" },
  pending_counterparty: { label: "Pending counterparty", tone: "warning" },
  resolved: { label: "Resolved", tone: "info" },
};
const causeLabel: Record<NonNullable<IcMatch["likelyCause"]>, string> = { fx: "FX", timing: "Timing", amount: "Amount" };
const kindLabel: Record<IcMatch["kind"], string> = { receivable_payable: "Receivable / payable", revenue_expense: "Revenue / expense" };

export function IntercompanyTab({ view, nameOf }: { view: ConsolidationView; nameOf: NameOf }) {
  const can = useCan();
  const [drafts, setDrafts] = useState<Record<string, JeDraft>>({});
  const trueUp = useAction((id: string) => api.post<{ match: IcMatch; draft: JeDraft }>(`/ic-matches/${id}/true-up`), {
    invalidate: CONS_KEYS,
    success: (r) => `True-up ${r.draft.number} drafted in ${nameOf(r.draft.entityId)}`,
    onSuccess: (r) => setDrafts((d) => ({ ...d, [r.match.id]: r.draft })),
  });

  return (
    <div className="space-y-4">
      <Note>
        Balances are matched in USD. A difference within tolerance — the greater of {moneyCompact(view.tolerance.absUsd)} or {view.tolerance.pct}% — auto-matches. A true-up is only a <strong>draft</strong> journal: it follows the normal human approval and posting rules before it touches a ledger.
      </Note>
      {view.matches.length === 0 ? (
        <EmptyState title="No intercompany balances" description="Nothing to match this period." />
      ) : (
        <Card className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>From → to</TH>
                <TH>Kind</TH>
                <TH className="text-right">From (USD)</TH>
                <TH className="text-right">To (USD)</TH>
                <TH className="text-right">Difference</TH>
                <TH>Status</TH>
                <TH className="min-w-[18rem]">AI explanation</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {view.matches.map((m) => {
                const over = Math.abs(m.difference) > m.tolerance;
                const draftId = drafts[m.id]?.id ?? m.trueUpDraftId;
                const draftEntity = drafts[m.id]?.entityId ?? m.toEntityId;
                const meta = matchMeta[m.status];
                return (
                  <TR key={m.id}>
                    <TD>
                      <div className="flex flex-wrap items-center gap-1 font-medium">
                        {nameOf(m.fromEntityId)} <ArrowRight className="size-3.5 text-muted-foreground" aria-label="to" /> {nameOf(m.toEntityId)}
                      </div>
                      <div className="text-xs text-muted-foreground">{m.id}</div>
                    </TD>
                    <TD className="text-xs">{kindLabel[m.kind]}</TD>
                    <TD className="text-right">
                      <Amount value={m.fromAmountUsd} />
                    </TD>
                    <TD className="text-right">
                      <Amount value={m.toAmountUsd} />
                    </TD>
                    <TD className="text-right">
                      <div className={cn("tabular", over ? "font-semibold text-destructive" : "text-muted-foreground")}>
                        <Amount value={m.difference} className={over ? "text-destructive" : undefined} />
                      </div>
                      <div className="text-[11px] text-muted-foreground">tol. {moneyCompact(m.tolerance)}</div>
                    </TD>
                    <TD>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={meta.tone}>{meta.label}</Badge>
                        {m.likelyCause ? <Badge variant="outline">Cause: {causeLabel[m.likelyCause]}</Badge> : null}
                      </div>
                    </TD>
                    <TD className="text-xs leading-relaxed">
                      {m.explanation ? (
                        <span className="flex gap-1.5">
                          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-ai" aria-hidden />
                          <span>{m.explanation}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      {draftId ? (
                        <Button asChild variant="link" size="sm">
                          <Link to={`/e/${draftEntity}/journals?draft=${draftId}`}>
                            <FileEdit /> Open draft
                          </Link>
                        </Button>
                      ) : m.status === "mismatch" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={trueUp.isPending && trueUp.variables === m.id}
                          disabled={!can("je.prepare", m.toEntityId)}
                          title={!can("je.prepare", m.toEntityId) ? `You can't prepare journals in ${nameOf(m.toEntityId)}` : undefined}
                          onClick={() => trueUp.mutate(m.id)}
                        >
                          Draft true-up
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ eliminations (CO-5)
const elimMeta: Record<Elimination["status"], { label: string; tone: Tone }> = {
  proposed: { label: "Proposed", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  posted: { label: "Posted", tone: "success" },
};

export function EliminationsTab({ view, canManage, locked }: { view: ConsolidationView; canManage: boolean; locked: boolean }) {
  const { data: me } = useMe();
  const userName = useUserName();
  const approve = useAction((id: string) => api.post<Elimination>(`/eliminations/${id}/approve`), {
    invalidate: [["consolidation"]],
    success: "Elimination approved and posted to the consolidation layer",
  });
  return (
    <div className="space-y-4">
      <Note>Eliminations post to this app&apos;s consolidation layer only. They never touch an entity&apos;s ERP ledger (decision D9).</Note>
      {view.eliminations.length === 0 ? (
        <EmptyState title="No eliminations" description="Eliminations are proposed from matched intercompany balances." />
      ) : (
        <Card className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Description</TH>
                <TH className="text-right">Amount</TH>
                <TH>Status</TH>
                <TH>Prepared / approved</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {view.eliminations.map((e) => {
                const mine = !!me && e.preparedBy === me.user.id;
                return (
                  <TR key={e.id}>
                    <TD>
                      <div className="font-medium">{e.description}</div>
                      <div className="text-xs text-muted-foreground">IC match {e.icMatchId}</div>
                    </TD>
                    <TD className="text-right">
                      <Amount value={e.amount} />
                    </TD>
                    <TD>
                      <Badge variant={elimMeta[e.status].tone}>{elimMeta[e.status].label}</Badge>
                    </TD>
                    <TD className="text-xs text-muted-foreground">
                      <div>Prepared: {e.preparedBy ? userName(e.preparedBy) : "AI (system)"}</div>
                      <div>Approved: {e.approvedBy ? userName(e.approvedBy) : "—"}</div>
                    </TD>
                    <TD className="text-right">
                      {e.status === "proposed" ? (
                        <div className="flex flex-col items-end gap-1">
                          <Button size="sm" loading={approve.isPending && approve.variables === e.id} disabled={!canManage || mine || locked} onClick={() => approve.mutate(e.id)}>
                            <Check /> Approve &amp; post
                          </Button>
                          {mine ? <span className="text-[11px] text-muted-foreground">You prepared this — someone else must approve.</span> : null}
                        </div>
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
      {!canManage ? <p className="text-xs text-muted-foreground">You need the consolidation permission to approve eliminations.</p> : null}
    </div>
  );
}

// ------------------------------------------------------------------ statements (CO-6)
function StatementTable({ title, lines, entityIds, nameOf }: { title: string; lines: ConsolidatedLine[]; entityIds: string[]; nameOf: NameOf }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>USD. Select an entity figure to drill into its flux review.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {lines.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No lines" />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Line</TH>
                {entityIds.map((id) => (
                  <TH key={id} className="text-right">
                    {nameOf(id)}
                  </TH>
                ))}
                <TH className="text-right">Eliminations</TH>
                <TH className="text-right">Consolidated</TH>
              </TR>
            </THead>
            <TBody>
              {lines.map((l) => (
                <TR key={l.code}>
                  <TD className="whitespace-nowrap font-medium">{l.name}</TD>
                  {entityIds.map((id) => (
                    <TD key={id} className="text-right">
                      <Link to={`/e/${id}/flux`} className="rounded hover:underline focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${l.name}, ${nameOf(id)}: open flux review`}>
                        <Amount value={l.byEntity[id] ?? 0} />
                      </Link>
                    </TD>
                  ))}
                  <TD className="text-right text-muted-foreground">
                    <Amount value={l.eliminations} />
                  </TD>
                  <TD className="text-right font-semibold">
                    <Amount value={l.consolidated} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function StatementsTab({ view, nameOf }: { view: ConsolidationView; nameOf: NameOf }) {
  const pl = view.statements.filter((s) => s.statement === "pl");
  const bs = view.statements.filter((s) => s.statement === "bs");
  const revenue = view.statements.find((s) => s.code === "REV");
  const chartData = useMemo(() => view.entityIds.map((id) => ({ name: nameOf(id), revenue: revenue?.byEntity[id] ?? 0 })), [view.entityIds, revenue, nameOf]);

  return (
    <div className="space-y-4">
      <StatementTable title="Profit and loss" lines={pl} entityIds={view.entityIds} nameOf={nameOf} />
      <StatementTable title="Balance sheet" lines={bs} entityIds={view.entityIds} nameOf={nameOf} />
      {revenue ? (
        <ChartCard
          title="Revenue by entity"
          description="USD, translated at the average rate."
          chart={
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval={0} />
                  <YAxis tickFormatter={(v: number) => moneyCompact(v)} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={56} />
                  <RTooltip
                    formatter={(v: number) => moneyCompact(v)}
                    cursor={{ fill: "hsl(var(--muted))" }}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 12 }}
                  />
                  <Bar dataKey="revenue" name="Revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          }
          table={
            <Table>
              <THead>
                <TR>
                  <TH>Entity</TH>
                  <TH className="text-right">Revenue (USD)</TH>
                </TR>
              </THead>
              <TBody>
                {chartData.map((d) => (
                  <TR key={d.name}>
                    <TD>{d.name}</TD>
                    <TD className="text-right">
                      <Amount value={d.revenue} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          }
        />
      ) : null}
    </div>
  );
}
