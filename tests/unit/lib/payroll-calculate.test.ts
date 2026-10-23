import { describe, expect, it } from "vitest";
import { calculatePayslip, type CalcComponent, type PayslipCalcInput } from "@/lib/payroll/calculate";

const c = (overrides: Partial<CalcComponent> & Pick<CalcComponent, "code" | "calc">): CalcComponent => ({
  name: overrides.code, kind: "earning", value: null, percentOf: null, percent: null, formula: null, prorate: true, round: "nearest",
  showOnPayslip: true, inCtc: true, ...overrides,
});
const STANDARD: CalcComponent[] = [
  c({ code: "BASIC", name: "Basic", calc: "formula", formula: "MONTHLY_CTC * 0.5" }),
  c({ code: "HRA", name: "House rent allowance", calc: "percent", percentOf: "BASIC", percent: 4000 }),
  c({ code: "SPECIAL", name: "Special allowance", calc: "balance" }),
  c({ code: "BONUS", name: "Bonus", calc: "input", prorate: false, inCtc: false }),
  c({ code: "COMP_OFF_PAY", name: "Comp-off payout", calc: "formula", formula: "COMP_OFF_DAYS * MONTHLY_CTC / 30", prorate: false, inCtc: false }),
  c({ code: "OTHER_DEDUCTION", name: "Other deduction", kind: "deduction", calc: "input", prorate: false, inCtc: false }),
  c({ code: "REIMB", name: "Reimbursements", kind: "reimbursement", calc: "input", prorate: false, inCtc: false }),
];
const days = (paid: number, total = 30) => ({ TOTAL_DAYS: total, PAID_DAYS: paid, LOP_DAYS: total - paid, COMP_OFF_DAYS: 0 });
const input = (overrides: Partial<PayslipCalcInput> = {}): PayslipCalcInput => ({
  annualCtc: 120_000_000, components: STANDARD, variables: days(30), inputs: [], ...overrides,
});
const amounts = (result: ReturnType<typeof calculatePayslip>) => Object.fromEntries(result.lines.map((l) => [l.code, l.amount]));

describe("calculatePayslip", () => {
  it("splits a 12 L CTC into basic, HRA and the balance", () => {
    const result = calculatePayslip(input());
    expect(result.errors).toEqual([]);
    expect(amounts(result)).toEqual({ BASIC: 5_000_000, HRA: 2_000_000, SPECIAL: 3_000_000 });
    expect(result).toMatchObject({ grossEarnings: 10_000_000, totalDeductions: 0, netPay: 10_000_000, warnings: [] });
    expect(result.lines.map((l) => l.explanation)).toEqual(["= MONTHLY_CTC * 0.5", "40% of BASIC 50,000.00", "Balance of CTC 1,00,000.00"]);
  });

  it("prorates by paid days and explains it", () => {
    const result = calculatePayslip(input({ variables: days(28) }));
    expect(amounts(result)).toEqual({ BASIC: 4_666_700, HRA: 1_866_700, SPECIAL: 2_800_000 });
    expect(result.lines[0]).toMatchObject({ rate: 5_000_000, explanation: "= MONTHLY_CTC * 0.5 × 28/30" });
    expect(result.netPay).toBe(4_666_700 + 1_866_700 + 2_800_000);
  });

  it("rounds each component its own way", () => {
    const odd = { annualCtc: 100_000_003 };
    const modes = (round: CalcComponent["round"]) =>
      calculatePayslip(input({ ...odd, components: [c({ code: "BASIC", calc: "formula", formula: "MONTHLY_CTC * 0.5", round })] })).lines[0]!.amount;
    expect([modes("none"), modes("nearest"), modes("up"), modes("down")]).toEqual([4_166_667, 4_166_700, 4_166_700, 4_166_600]);
  });

  it("lets formulas use earned amounts or full-month rates", () => {
    const components = [
      ...STANDARD.slice(0, 3),
      c({ code: "PF", kind: "deduction", calc: "formula", formula: "min(BASIC, 15000) * 0.12", prorate: false, inCtc: false }),
      c({ code: "PF_FULL", kind: "deduction", calc: "formula", formula: "min(BASIC_RATE, 15000) * 0.12", prorate: false, inCtc: false }),
    ];
    const result = calculatePayslip(input({ components, variables: days(15) }));
    expect(amounts(result)).toMatchObject({ BASIC: 2_500_000, PF: 180_000, PF_FULL: 180_000 });
    const low = calculatePayslip(input({ annualCtc: 24_000_000, components, variables: days(15) }));
    expect(amounts(low)).toMatchObject({ BASIC: 500_000, PF: 60_000, PF_FULL: 120_000 });
  });

  it("never lets the balance go negative", () => {
    const components = [c({ code: "BASIC", calc: "fixed", value: 12_000_000 }), c({ code: "SPECIAL", calc: "balance" })];
    const result = calculatePayslip(input({ components }));
    expect(amounts(result)).toEqual({ BASIC: 12_000_000 });
    expect(result.warnings).toEqual(["SPECIAL: the other components exceed the CTC, so it is 0"]);
  });

  it("adds inputs and extra lines, which don't change the balance", () => {
    const result = calculatePayslip(
      input({
        variables: { ...days(30), COMP_OFF_DAYS: 1 },
        inputs: [
          { code: "BONUS", amount: 500_000, label: "Bonus", source: "manual" },
          { code: "BONUS", amount: 250_000, label: "Bonus", source: "manual" },
          { code: "REIMB", amount: 120_050, label: "Claim: travel on 12 Oct", source: "claim" },
          { code: "OTHER_DEDUCTION", amount: 100_000, label: "Other deduction", source: "manual" },
          { code: "BASIC", amount: 300_000, label: "Arrears – Basic (Sep 2026)", source: "arrear" },
        ],
      }),
    );
    expect(result.lines.map((l) => [l.code, l.amount, l.source])).toEqual([
      ["BASIC", 5_000_000, "component"],
      ["HRA", 2_000_000, "component"],
      ["SPECIAL", 3_000_000, "component"],
      ["BONUS", 750_000, "component"],
      ["COMP_OFF_PAY", 333_300, "component"],
      ["OTHER_DEDUCTION", 100_000, "component"],
      ["REIMB", 120_050, "claim"],
      ["BASIC", 300_000, "arrear"],
    ]);
    expect(result.lines.at(-1)!.name).toBe("Arrears – Basic (Sep 2026)");
    expect(result).toMatchObject({ grossEarnings: 11_503_350, reimbursements: 120_050, totalDeductions: 100_000, netPay: 11_403_350 });
  });

  it("caps deductions at gross pay and says so", () => {
    const result = calculatePayslip(
      input({
        variables: days(1),
        inputs: [
          { code: "OTHER_DEDUCTION", amount: 200_000, label: "Other deduction", source: "manual" },
          { code: "LOAN_EMI", amount: 400_000, label: "Loan EMI", source: "loan" },
        ],
        components: [...STANDARD, c({ code: "LOAN_EMI", kind: "deduction", calc: "input", prorate: false, inCtc: false })],
      }),
    );
    expect(result.grossEarnings).toBe(166_700 + 66_700 + 100_000);
    expect(result.netPay).toBe(0);
    // The latest deduction gives way first.
    expect(result.lines.find((l) => l.source === "loan")!.amount).toBe(133_400);
    expect(result.warnings).toEqual(["Deductions capped at gross pay: 2,666.00 not deducted"]);
  });

  it("reports formula problems instead of computing", () => {
    expect(calculatePayslip(input({ components: [c({ code: "X", calc: "formula", formula: "MONTHLY_CTC / (PAID_DAYS - 30)" })] })).errors).toEqual([
      "X: Division by zero",
    ]);
    expect(
      calculatePayslip(input({ components: [c({ code: "A", calc: "formula", formula: "B_RATE" }), c({ code: "B", calc: "formula", formula: "A" })] })).errors,
    ).toEqual(["Circular reference: A → B → A"]);
    expect(calculatePayslip(input({ components: [c({ code: "A", calc: "formula", formula: "NOPE" })] })).errors).toEqual(["A: Unknown name NOPE"]);
    expect(calculatePayslip(input({ components: [c({ code: "HRA", calc: "percent", percentOf: "BASIC", percent: 4000 })] })).errors).toEqual([
      "HRA: BASIC is not in the structure",
    ]);
  });

  it("pays nothing prorated when there are no days at all", () => {
    expect(amounts(calculatePayslip(input({ variables: days(0, 0) })))).toEqual({ BASIC: 0, HRA: 0, SPECIAL: 0 });
  });
});
