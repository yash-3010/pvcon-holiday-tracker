import { describe, expect, it } from "vitest";
import type { CalcComponent } from "@/lib/payroll/calculate";
import { calcSummary, previewComponent } from "@/lib/payroll/preview";

const c = (overrides: Partial<CalcComponent> & Pick<CalcComponent, "code" | "calc">): CalcComponent => ({
  name: overrides.code, kind: "earning", value: null, percentOf: null, percent: null, formula: null, prorate: true, round: "nearest",
  showOnPayslip: true, inCtc: true, ...overrides,
});
const ALL = [
  c({ code: "BASIC", name: "Basic", calc: "formula", formula: "MONTHLY_CTC * 0.5" }),
  c({ code: "HRA", calc: "percent", percentOf: "BASIC", percent: 4000 }),
  c({ code: "SPECIAL", calc: "balance" }),
  c({ code: "OTHER_BAL", calc: "balance" }),
  c({ code: "BONUS", calc: "input", inCtc: false, prorate: false }),
];

describe("previewComponent", () => {
  it("computes a component with just what it depends on", () => {
    expect(previewComponent(ALL, c({ code: "PF", kind: "deduction", calc: "formula", formula: "min(BASIC, 15000) * 0.12", inCtc: false }), 120_000_000))
      .toEqual({ amount: 180_000, explanation: "= min(BASIC, 15000) * 0.12" });
    expect(previewComponent(ALL, ALL[1]!, 120_000_000)).toEqual({ amount: 2_000_000, explanation: "40% of BASIC 50,000.00" });
    // A balance leaves room for the other CTC components, ignoring other balances.
    expect(previewComponent(ALL, ALL[2]!, 120_000_000)).toMatchObject({ amount: 3_000_000 });
  });

  it("reports problems", () => {
    expect(previewComponent(ALL, c({ code: "X", calc: "formula", formula: "NOPE * 2" }), 120_000_000)).toEqual({ error: "X: Unknown name NOPE" });
    expect(previewComponent(ALL, c({ code: "X", calc: "formula", formula: "1 +" }), 120_000_000)).toEqual({ error: "X: Unexpected end of formula" });
  });
});

describe("calcSummary", () => {
  it("describes how a component is calculated", () => {
    expect(ALL.map((x) => calcSummary(x))).toEqual(["= MONTHLY_CTC * 0.5", "40% of BASIC", "Balance of the CTC", "Balance of the CTC", "Entered each run"]);
    expect(calcSummary(c({ code: "F", calc: "fixed", value: 160_050 }))).toBe("Fixed 1,600.50 a month");
  });
});
