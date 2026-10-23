import { roundMinor, toMajor, toMinor, type Minor, type RoundMode } from "@/lib/money";
import type { ComponentCalc, ComponentKind, InputSource } from "./constants";
import { VARIABLES } from "./constants";
import { evaluate } from "./formula/evaluate";
import { dependencyOrder } from "./formula/graph";
import { FormulaError } from "./formula/lexer";
import { identifiers, parseFormula, type Node } from "./formula/parser";

/** A structure component with the structure's and the employee's overrides already applied. */
export interface CalcComponent {
  code: string;
  name: string;
  kind: ComponentKind;
  calc: ComponentCalc;
  /** Fixed monthly amount (paise). */
  value: Minor | null;
  percentOf: string | null;
  /** Basis points. */
  percent: number | null;
  formula: string | null;
  prorate: boolean;
  round: RoundMode;
  showOnPayslip: boolean;
  /** Counts towards the CTC, so the balance component leaves room for it. */
  inCtc: boolean;
}

export interface CalcInput {
  code: string;
  amount: Minor;
  label: string;
  source: InputSource;
  /** Needed when the code is not a component of the structure. */
  kind?: ComponentKind;
}

export interface PayslipCalcInput {
  annualCtc: Minor;
  components: readonly CalcComponent[];
  /** Day summary and the other formula variables; missing ones are 0. */
  variables: Readonly<Record<string, number>> & { TOTAL_DAYS: number; PAID_DAYS: number };
  inputs: readonly CalcInput[];
}

export interface CalcLine {
  code: string;
  name: string;
  kind: ComponentKind;
  amount: Minor;
  /** Full-month amount before proration; null for input lines. */
  rate: Minor | null;
  explanation: string;
  source: "component" | InputSource;
  showOnPayslip: boolean;
  sortOrder: number;
}

export interface PayslipCalcResult {
  lines: CalcLine[];
  grossEarnings: Minor;
  totalDeductions: Minor;
  employerContributions: Minor;
  reimbursements: Minor;
  netPay: Minor;
  warnings: string[];
  /** Formula or structure problems; nothing is computed when there are any. */
  errors: string[];
}

const amountText = (minor: Minor) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toMajor(minor));
const percentText = (bp: number) => `${Number((bp / 100).toFixed(2))}%`;

function failed(errors: string[]): PayslipCalcResult {
  return { lines: [], grossEarnings: 0, totalDeductions: 0, employerContributions: 0, reimbursements: 0, netPay: 0, warnings: [], errors };
}

/**
 * Computes a payslip (spec §5.6). Components run in dependency order; `balance` comes after every CTC earning and
 * employer contribution. Each component has a full-month `rate` and an earned `amount` (prorated by PAID_DAYS /
 * TOTAL_DAYS when `prorate`), both rounded with its own mode. Formulas work in rupees. Manual inputs to `input`
 * components set their rate; every other input becomes its own line. Deductions are capped so net pay never goes below 0.
 */
export function calculatePayslip(input: PayslipCalcInput): PayslipCalcResult {
  const { components, variables } = input;
  const codes = new Set(components.map((c) => c.code));
  const known = new Set<string>([...VARIABLES, ...[...codes].flatMap((code) => [code, `${code}_RATE`])]);

  const asts = new Map<string, Node>();
  const deps = new Map<string, string[]>();
  for (const c of components) {
    if (c.calc === "formula") {
      try {
        const ast = parseFormula(c.formula ?? "");
        const names = identifiers(ast);
        const unknown = names.find((n) => !known.has(n));
        if (unknown) return failed([`${c.code}: Unknown name ${unknown}`]);
        asts.set(c.code, ast);
        deps.set(c.code, names.map((n) => n.replace(/_RATE$/, "")).filter((n) => codes.has(n)));
      } catch (err) {
        if (err instanceof FormulaError) return failed([`${c.code}: ${err.message}`]);
        throw err;
      }
    } else if (c.calc === "percent") {
      if (!c.percentOf || !codes.has(c.percentOf)) return failed([`${c.code}: ${c.percentOf ?? "its base"} is not in the structure`]);
      deps.set(c.code, [c.percentOf]);
    } else if (c.calc === "balance") {
      deps.set(c.code, components.filter((o) => o.code !== c.code && o.inCtc && (o.kind === "earning" || o.kind === "employer_contribution")).map((o) => o.code));
    } else {
      deps.set(c.code, []);
    }
  }
  if (components.filter((c) => c.calc === "balance").length > 1) return failed(["Only one balance component is allowed"]);

  let order: string[];
  try {
    order = dependencyOrder(components.map((c) => ({ code: c.code, deps: deps.get(c.code) ?? [] })));
  } catch (err) {
    if (err instanceof FormulaError) return failed([err.message]);
    throw err;
  }

  const monthlyCtc = input.annualCtc / 12;
  const vars: Record<string, number> = Object.fromEntries(VARIABLES.map((v) => [v, variables[v] ?? 0]));
  vars.CTC = toMajor(input.annualCtc);
  vars.MONTHLY_CTC = toMajor(monthlyCtc);
  const { TOTAL_DAYS: total, PAID_DAYS: paid } = variables;
  const prorated = total > 0 && paid !== total;

  const rates = new Map<string, Minor>();
  const amounts = new Map<string, Minor>();
  const explanations = new Map<string, string>();
  const warnings: string[] = [];
  const manual = (code: string) => input.inputs.filter((i) => i.code === code && i.source === "manual").reduce((s, i) => s + i.amount, 0);

  for (const code of order) {
    const c = components.find((x) => x.code === code)!;
    let raw: number;
    let explanation: string;
    switch (c.calc) {
      case "fixed":
        raw = c.value ?? 0;
        explanation = amountText(raw);
        break;
      case "percent": {
        const base = rates.get(c.percentOf!) ?? 0;
        raw = (base * (c.percent ?? 0)) / 10_000;
        explanation = `${percentText(c.percent ?? 0)} of ${c.percentOf} ${amountText(base)}`;
        break;
      }
      case "formula":
        try {
          raw = toMinor(evaluate(asts.get(code)!, vars));
        } catch (err) {
          if (err instanceof FormulaError) return failed([`${code}: ${err.message}`]);
          throw err;
        }
        explanation = `= ${c.formula}`;
        break;
      case "balance": {
        const others = (deps.get(code) ?? []).reduce((s, d) => s + (rates.get(d) ?? 0), 0);
        raw = monthlyCtc - others;
        if (raw < 0) {
          warnings.push(`${code}: the other components exceed the CTC, so it is 0`);
          raw = 0;
        }
        explanation = `Balance of CTC ${amountText(roundMinor(monthlyCtc, "none"))}`;
        break;
      }
      case "input":
        raw = manual(code);
        explanation = "Entered for this run";
        break;
    }
    const rate = roundMinor(raw, c.round);
    const amount = c.prorate ? (total > 0 ? roundMinor((rate * paid) / total, c.round) : 0) : rate;
    rates.set(code, rate);
    amounts.set(code, amount);
    explanations.set(code, c.prorate && prorated ? `${explanation} × ${paid}/${total}` : explanation);
    vars[code] = toMajor(amount);
    vars[`${code}_RATE`] = toMajor(rate);
  }

  const lines: CalcLine[] = [];
  for (const c of components) {
    const rate = rates.get(c.code)!;
    const amount = amounts.get(c.code)!;
    // Components that don't apply this month (nothing to pay at any rate) stay off the payslip.
    if (rate === 0 && amount === 0) continue;
    lines.push({
      code: c.code, name: c.name, kind: c.kind, amount, rate: c.calc === "input" ? null : rate, explanation: explanations.get(c.code)!,
      source: "component", showOnPayslip: c.showOnPayslip, sortOrder: lines.length,
    });
  }
  for (const i of input.inputs) {
    const component = components.find((c) => c.code === i.code);
    if (i.source === "manual" && component?.calc === "input") continue;
    const kind = component?.kind ?? i.kind;
    if (!kind) return failed([`${i.label}: ${i.code} is not in the structure`]);
    lines.push({
      code: i.code, name: i.label, kind, amount: i.amount, rate: null, explanation: i.label, source: i.source,
      showOnPayslip: component?.showOnPayslip ?? true, sortOrder: lines.length,
    });
  }

  const sum = (kind: ComponentKind) => lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0);
  const reimbursements = sum("reimbursement");
  const grossEarnings = sum("earning") + reimbursements;
  let totalDeductions = sum("deduction");
  if (totalDeductions > grossEarnings) {
    let excess = totalDeductions - grossEarnings;
    warnings.push(`Deductions capped at gross pay: ${amountText(excess)} not deducted`);
    for (const line of [...lines].reverse()) {
      if (line.kind !== "deduction" || excess === 0) continue;
      const cut = Math.min(line.amount, excess);
      line.amount -= cut;
      excess -= cut;
    }
    totalDeductions = grossEarnings;
  }
  return {
    lines, grossEarnings, totalDeductions, employerContributions: sum("employer_contribution"), reimbursements,
    netPay: grossEarnings - totalDeductions, warnings, errors: [],
  };
}
