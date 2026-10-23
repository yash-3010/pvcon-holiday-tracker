import { describe, expect, it } from "vitest";
import { z } from "zod";
import { claimSchema, componentSchema, inputSchema, loanSchema, runCreateSchema, salarySchema } from "@/lib/validation/payroll";

const fieldErrors = (result: { success: boolean; error?: z.ZodError }) =>
  result.success ? {} : (z.flattenError(result.error!).fieldErrors as Record<string, string[]>);

const component = {
  code: "PF", name: "Provident fund", kind: "deduction", calc: "formula", defaultValue: null, percentOf: null, percent: null,
  formula: "min(BASIC, 15000) * 0.12", prorate: false, inCtc: false, round: "nearest", showOnPayslip: true, taxableLabel: "",
};

describe("componentSchema", () => {
  it("normalises amounts to paise and percents to basis points", () => {
    expect(componentSchema.parse({ ...component, calc: "fixed", formula: null, defaultValue: 1600.5 })).toMatchObject({ defaultValue: 160050, formula: null });
    expect(componentSchema.parse({ ...component, calc: "percent", formula: null, percentOf: "BASIC", percent: 12.5 })).toMatchObject({ percent: 1250, percentOf: "BASIC" });
    expect(componentSchema.parse(component)).toMatchObject({ formula: "min(BASIC, 15000) * 0.12", taxableLabel: null });
  });

  it("refuses codes that clash with variables or the _RATE suffix, and missing calc fields", () => {
    expect(fieldErrors(componentSchema.safeParse({ ...component, code: "PAID_DAYS" }))).toHaveProperty("code");
    expect(fieldErrors(componentSchema.safeParse({ ...component, code: "BASIC_RATE" }))).toHaveProperty("code");
    expect(fieldErrors(componentSchema.safeParse({ ...component, code: "pf" }))).toHaveProperty("code");
    expect(fieldErrors(componentSchema.safeParse({ ...component, calc: "percent", formula: null }))).toHaveProperty("percentOf");
    expect(fieldErrors(componentSchema.safeParse({ ...component, calc: "fixed", formula: null }))).toHaveProperty("defaultValue");
    expect(fieldErrors(componentSchema.safeParse({ ...component, formula: "" }))).toHaveProperty("formula");
    expect(fieldErrors(componentSchema.safeParse({ ...component, formula: "BASIC *" }))).toEqual({ formula: ["Unexpected end of formula"] });
  });
});

describe("salaries, runs, inputs, loans, claims", () => {
  it("wants a salary effective from the 1st of a month", () => {
    const salary = { employeeId: 1, effectiveFrom: "2026-11-01", annualCtc: 1_200_000, structureId: 1, overrides: {}, reason: "" };
    expect(salarySchema.parse(salary)).toMatchObject({ annualCtc: 120_000_000, reason: null });
    expect(fieldErrors(salarySchema.safeParse({ ...salary, effectiveFrom: "2026-11-15" }))).toEqual({ effectiveFrom: ["Salaries change from the 1st of a month"] });
    expect(fieldErrors(salarySchema.safeParse({ ...salary, annualCtc: 0 }))).toHaveProperty("annualCtc");
    expect(salarySchema.parse({ ...salary, overrides: { BASIC: 40000, HRA: "BASIC * 0.5" } }).overrides).toEqual({ BASIC: 4_000_000, HRA: "BASIC * 0.5" });
  });

  it("checks runs, inputs, loans and claims", () => {
    expect(fieldErrors(runCreateSchema.safeParse({ period: "2026-13", type: "regular", notes: "" }))).toHaveProperty("period");
    expect(inputSchema.parse({ runId: 1, employeeId: 2, componentId: 3, amount: 2500.25, note: "Festival bonus" }).amount).toBe(250025);
    expect(fieldErrors(loanSchema.safeParse({ employeeId: 1, type: "loan", principal: 10000, emi: 12000, startPeriod: "2026-11", note: "" }))).toEqual({
      emi: ["Can't be more than the principal"],
    });
    expect(fieldErrors(claimSchema.safeParse({ category: "travel", claimDate: "2026-11-02", amount: -5, description: "Cab" }))).toHaveProperty("amount");
  });
});
