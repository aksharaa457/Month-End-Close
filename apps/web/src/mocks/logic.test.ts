import { beforeEach, describe, expect, it } from "vitest";
import { db, seed, setDb } from "./db";
import { HttpProblem, assertCanApprove, evaluateContracts, isFlagged, lockGates, variancesFor } from "./logic";

const user = (id: string) => db().users.find((u) => u.id === id)!;
const draft = (n: string) => db().drafts.find((d) => d.number === n)!;
const code = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpProblem ? e.problem.code ?? e.problem.title : String(e);
  }
  return null;
};

beforeEach(() => setDb(seed()));

describe("materiality thresholds (FX-2)", () => {
  const t = { absAmount: 25000, pct: 10 } as never;
  it("flags when the amount trips", () => expect(isFlagged(1_000_000, 970_000, t)).toBe(true));
  it("flags when the percentage trips", () => expect(isFlagged(1432.51, 49.04, t)).toBe(true));
  it("does not flag small movements", () => expect(isFlagged(1570.62, 1626.04, t)).toBe(false));
  it("uses only the amount when the prior month is zero (EC-3)", () => {
    expect(isFlagged(0, 445, t)).toBe(false);
    const hiring = variancesFor("e-us").find((v) => v.accountCode === "60104001")!;
    expect(hiring.deltaPct).toBeNull();
  });
  it("rolls group balances up from children", () => {
    const rec = variancesFor("e-us").find((v) => v.accountName === "Recurring Revenue")!;
    expect(rec.prior).toBeCloseTo(672258.25, 2);
    expect(rec.attributions[0].sharePct).toBeCloseTo(85.1, 0);
  });
});

describe("JE approval segregation of duties (JE-4)", () => {
  it("refuses the preparer, even when they hold the approver role", () => {
    const d = draft("JE-1001");
    d.preparerId = "u-omar"; // Omar is an approver who also edited this entry
    expect(code(() => assertCanApprove(user("u-omar"), d, d.version))).toBe("sod_preparer");
  });
  it("refuses a stale version", () => {
    const d = draft("JE-1001");
    expect(code(() => assertCanApprove(user("u-omar"), d, d.version + 1))).toBe("stale_version");
  });
  it("refuses a role without je.approve", () => {
    const d = draft("JE-1001");
    expect(code(() => assertCanApprove(user("u-ellen"), d, d.version))).toBe("forbidden");
  });
  it("refuses the same person giving the second approval", () => {
    const d = draft("JE-1001");
    expect(d.requiresSecondApproval).toBe(true);
    d.approvals.push({ id: "a", level: 1, approverId: "u-omar", decision: "approved", draftVersion: d.version, comment: null, decidedAt: "", batchId: null });
    expect(code(() => assertCanApprove(user("u-omar"), d, d.version))).toBe("sod_second_approver");
    expect(code(() => assertCanApprove(user("u-daniel"), d, d.version))).toBeNull();
  });
});

describe("period lock gates", () => {
  it("blocks the lock while tasks, variances and mappings are open", () => {
    const gates = lockGates("e-us");
    expect(gates.map((g) => g.met)).toEqual([false, false, false]);
    expect(gates.find((g) => g.key === "mappings")!.detail).toMatch(/1 account/);
  });
});

describe("auto-apply policy (§10.1)", () => {
  it("auto-applies only items that pass every check", () => {
    evaluateContracts("e-us");
    const col = (id: string) => db().contracts.find((c) => c.id === id)!.column;
    expect(col("k-arya")).toBe("auto_applied"); // $2,363, 0.95
    expect(col("k-voltgrid")).toBe("needs_review"); // over $5,000
    expect(col("k-pinecrest")).toBe("needs_review"); // confidence 0.82
    expect(col("k-orbit")).toBe("needs_review"); // modified this period
    expect(col("k-gulf")).toBe("needs_review"); // no evidence
  });
  it("kill switch sends everything to review", () => {
    db().autoApply[0].enabled = false;
    evaluateContracts("e-us");
    expect(db().contracts.filter((c) => c.column === "auto_applied")).toHaveLength(0);
  });
});
