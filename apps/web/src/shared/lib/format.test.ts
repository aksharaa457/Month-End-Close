import { describe, expect, it } from "vitest";
import { closeDay, money, pct, periodLabel } from "./format";

describe("format", () => {
  it("formats money with sign", () => {
    expect(money(-672258.25)).toBe("-$672,258.25");
    expect(money(900, "USD", { signed: true })).toBe("+$900.00");
  });
  it("shows n/a for undefined percentages", () => expect(pct(null)).toBe("n/a"));
  it("formats close days", () => {
    expect(closeDay(8)).toBe("D+8");
    expect(closeDay(7.6)).toBe("D+7.6");
  });
  it("labels periods", () => expect(periodLabel("2026-08")).toBe("Aug 2026"));
});
