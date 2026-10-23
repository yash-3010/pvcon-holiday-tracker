import { z } from "zod";
import { isISODate, isPeriod } from "@/lib/dates";
import { toMinor } from "@/lib/money";
import {
  CLAIM_CATEGORIES, COMPONENT_CALCS, COMPONENT_KINDS, LOAN_TYPES, ROUND_MODES, RUN_TYPES, VARIABLES,
} from "@/lib/payroll/constants";
import { FormulaError } from "@/lib/payroll/formula/lexer";
import { parseFormula } from "@/lib/payroll/formula/parser";
import { optionalText } from "./employees";

const id = z.number().int().positive();
const period = z.string().trim().refine(isPeriod, "Use YYYY-MM");
/** Rupees typed in a form → paise. */
const rupees = (max = 100_000_000) => z.number().min(0, "Can't be negative").max(max).transform(toMinor);
const positiveRupees = (max = 100_000_000) => z.number().positive("Must be more than zero").max(max).transform(toMinor);

const RESERVED = new Set<string>(VARIABLES);
export const componentCode = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]*$/, "Capital letters, digits and _; start with a letter")
  .max(30)
  .refine((c) => !RESERVED.has(c), "This name is a formula variable")
  .refine((c) => !c.endsWith("_RATE"), "Codes can't end in _RATE");

/** Syntax only; names are checked against the structure when it is saved. */
function formulaSyntaxError(text: string): string | null {
  try {
    parseFormula(text);
    return null;
  } catch (err) {
    if (err instanceof FormulaError) return err.message;
    throw err;
  }
}

export const componentSchema = z
  .object({
    code: componentCode,
    name: z.string().trim().min(1, "Required").max(80),
    kind: z.enum(COMPONENT_KINDS),
    calc: z.enum(COMPONENT_CALCS),
    /** Fixed monthly amount in rupees. */
    defaultValue: rupees().nullable(),
    percentOf: componentCode.nullable(),
    /** 0–100 with two decimals → basis points. */
    percent: z.number().min(0).max(100).transform((p) => Math.round(p * 100)).nullable(),
    formula: z.string().trim().max(500).nullable(),
    prorate: z.boolean(),
    /** Part of the CTC (earnings and employer contributions): the balance component leaves room for it. */
    inCtc: z.boolean(),
    round: z.enum(ROUND_MODES),
    showOnPayslip: z.boolean(),
    taxableLabel: optionalText(60),
  })
  .superRefine((c, ctx) => {
    if (c.calc === "fixed" && c.defaultValue === null) ctx.addIssue({ code: "custom", path: ["defaultValue"], message: "Enter the monthly amount" });
    if (c.calc === "percent") {
      if (!c.percentOf) ctx.addIssue({ code: "custom", path: ["percentOf"], message: "Choose the base component" });
      if (c.percent === null) ctx.addIssue({ code: "custom", path: ["percent"], message: "Enter the percent" });
      if (c.percentOf === c.code) ctx.addIssue({ code: "custom", path: ["percentOf"], message: "Can't be a percent of itself" });
    }
    if (c.calc === "formula") {
      if (!c.formula) ctx.addIssue({ code: "custom", path: ["formula"], message: "Enter a formula" });
      else {
        const error = formulaSyntaxError(c.formula);
        if (error) ctx.addIssue({ code: "custom", path: ["formula"], message: error });
      }
    }
  })
  .transform((c) => ({
    ...c,
    // Keep only the fields the calc type uses.
    defaultValue: c.calc === "fixed" ? c.defaultValue : null,
    percentOf: c.calc === "percent" ? c.percentOf : null,
    percent: c.calc === "percent" ? c.percent : null,
    formula: c.calc === "formula" ? c.formula : null,
  }));
export type ComponentInput = z.output<typeof componentSchema>;

/** A structure line may replace the component's amount, percent or formula; null keeps the component's own. */
export const structureLineSchema = z.object({
  componentId: id,
  value: rupees().nullable(),
  percent: z.number().min(0).max(100).transform((p) => Math.round(p * 100)).nullable(),
  formula: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((v) => (v ? v : null))
    .superRefine((v, ctx) => {
      const error = v ? formulaSyntaxError(v) : null;
      if (error) ctx.addIssue({ code: "custom", message: error });
    }),
});

export const structureSchema = z.object({
  name: z.string().trim().min(1, "Required").max(80),
  description: optionalText(300),
  lines: z
    .array(structureLineSchema)
    .min(1, "Add at least one component")
    .max(60)
    .refine((lines) => new Set(lines.map((l) => l.componentId)).size === lines.length, "Each component once"),
});
export type StructureInput = z.output<typeof structureSchema>;

/** Per-employee overrides: a monthly amount in rupees, or a formula. */
const overrideValue = z.union([z.number().min(0).max(100_000_000).transform(toMinor), z.string().trim().min(1).max(500)]);

export const salarySchema = z.object({
  employeeId: id,
  effectiveFrom: z
    .string()
    .trim()
    .refine((d) => isISODate(d) && d.endsWith("-01"), "Salaries change from the 1st of a month"),
  annualCtc: positiveRupees(1_000_000_000),
  structureId: id,
  overrides: z.record(componentCode, overrideValue),
  reason: optionalText(300),
});
export type SalaryInput = z.output<typeof salarySchema>;

export const runCreateSchema = z.object({ period, type: z.enum(RUN_TYPES), notes: optionalText(300) });

export const inputSchema = z.object({
  runId: id,
  employeeId: id,
  componentId: id,
  amount: positiveRupees(),
  note: optionalText(200),
});

export const loanSchema = z
  .object({
    employeeId: id,
    type: z.enum(LOAN_TYPES),
    principal: positiveRupees(),
    emi: positiveRupees(),
    startPeriod: period,
    note: optionalText(300),
  })
  .superRefine((l, ctx) => {
    if (l.emi > l.principal) ctx.addIssue({ code: "custom", path: ["emi"], message: "Can't be more than the principal" });
  });

export const claimSchema = z.object({
  category: z.enum(CLAIM_CATEGORIES),
  claimDate: z.string().trim().refine(isISODate, "Enter a valid date"),
  amount: positiveRupees(10_000_000),
  description: z.string().trim().min(3, "Say what it was for").max(300),
});
export type ClaimInput = z.output<typeof claimSchema>;
