import { toMajor, type Minor } from "@/lib/money";
import { calculatePayslip, type CalcComponent } from "./calculate";
import { FormulaError } from "./formula/lexer";
import { identifiers, parseFormula } from "./formula/parser";

const FULL_MONTH = { TOTAL_DAYS: 30, PAID_DAYS: 30, WORKING_DAYS: 22, PRESENT_DAYS: 22 };
const amountText = (minor: Minor) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toMajor(minor));

function dependencies(component: CalcComponent, all: readonly CalcComponent[]): string[] {
  const codes = new Set(all.map((x) => x.code));
  switch (component.calc) {
    case "percent":
      return component.percentOf ? [component.percentOf] : [];
    case "formula":
      try {
        return identifiers(parseFormula(component.formula ?? "")).map((n) => n.replace(/_RATE$/, "")).filter((n) => codes.has(n));
      } catch (err) {
        if (err instanceof FormulaError) return [];
        throw err;
      }
    case "balance":
      return all
        .filter((x) => x.code !== component.code && x.calc !== "balance" && x.inCtc && (x.kind === "earning" || x.kind === "employer_contribution"))
        .map((x) => x.code);
    default:
      return [];
  }
}

/**
 * One component over a full month at a sample CTC, computed with only the components it depends on (so other
 * balances or unrelated formulas don't interfere). For the component editor's live preview.
 */
export function previewComponent(
  all: readonly CalcComponent[],
  target: CalcComponent,
  annualCtc: Minor,
): { amount: Minor; explanation: string } | { error: string } {
  const pool = [...all.filter((x) => x.code !== target.code), target];
  const needed = new Map<string, CalcComponent>();
  const visit = (component: CalcComponent) => {
    if (needed.has(component.code)) return;
    needed.set(component.code, component);
    for (const code of dependencies(component, pool)) {
      const dep = pool.find((x) => x.code === code);
      if (dep) visit(dep);
    }
  };
  visit(target);
  const result = calculatePayslip({ annualCtc, components: [...needed.values()], variables: FULL_MONTH, inputs: [] });
  if (result.errors.length) return { error: result.errors[0]! };
  const line = result.lines.find((l) => l.code === target.code);
  return { amount: line?.amount ?? 0, explanation: line?.explanation ?? "" };
}

/** How a component is calculated, in a few words. */
export function calcSummary(component: Pick<CalcComponent, "calc" | "value" | "percent" | "percentOf" | "formula">): string {
  switch (component.calc) {
    case "fixed":
      return `Fixed ${amountText(component.value ?? 0)} a month`;
    case "percent":
      return `${Number(((component.percent ?? 0) / 100).toFixed(2))}% of ${component.percentOf}`;
    case "formula":
      return `= ${component.formula}`;
    case "balance":
      return "Balance of the CTC";
    case "input":
      return "Entered each run";
  }
}
