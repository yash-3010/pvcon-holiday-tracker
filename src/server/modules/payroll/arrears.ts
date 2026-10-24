import { and, asc, eq, inArray, lt, ne } from "drizzle-orm";
import { formatDate } from "@/lib/dates";
import type { Minor } from "@/lib/money";
import { calculatePayslip, type PayslipCalcResult } from "@/lib/payroll/calculate";
import { CLOSED_RUN_STATUSES } from "@/lib/payroll/constants";
import type { DbLike } from "@/server/db/client";
import { employeeSalaries, payrollInputs, payrollRuns, payslips, type EmployeeSalaryRow, type PayrollRunRow } from "@/server/db/schema";
import { componentByCode } from "./components";
import { effectiveSalary } from "./salaries";
import { applyOverrides, structureComponents } from "./structures";

export interface ArrearInput {
  employeeId: number;
  componentId: number;
  amount: Minor;
  label: string;
  /** The earlier payslip the difference is for. */
  sourceId: number;
  /** The salary that payslip is brought up to. */
  salaryId: number;
}

function computeWith(db: DbLike, salary: EmployeeSalaryRow, variables: Record<string, number>): PayslipCalcResult {
  return calculatePayslip({
    annualCtc: salary.annualCtc,
    components: applyOverrides(structureComponents(db, salary.structureId), salary.overrides),
    variables: { TOTAL_DAYS: 0, PAID_DAYS: 0, ...variables },
    inputs: [],
  });
}

/**
 * Arrears for back-dated revisions (spec §5.6 "Arrears"). For each paid payslip of an earlier approved regular run
 * whose month now has a different salary than it was paid on, the calculator runs again with the payslip's stored
 * variables (no attendance recompute) under the salary it was paid on and the current one; each component that
 * differs becomes an input `Arrears – <component> (<Mon YYYY>)`. Only employees in `employeeIds` are considered.
 */
export function arrearsFor(db: DbLike, run: PayrollRunRow, employeeIds: readonly number[]): { inputs: ArrearInput[]; warnings: string[] } {
  const inputs: ArrearInput[] = [];
  const warnings: string[] = [];
  if (run.type !== "regular" || !employeeIds.length) return { inputs, warnings };
  const earlier = db
    .select({ payslip: payslips, period: payrollRuns.period })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .where(
      and(
        eq(payrollRuns.type, "regular"),
        inArray(payrollRuns.status, CLOSED_RUN_STATUSES),
        lt(payrollRuns.period, run.period),
        ne(payslips.status, "excluded"),
        inArray(payslips.employeeId, [...employeeIds]),
      ),
    )
    .orderBy(asc(payrollRuns.period), asc(payslips.employeeId))
    .all();

  for (const { payslip, period } of earlier) {
    const basisId = payslip.paidBasisSalaryId ?? payslip.salaryId;
    const current = effectiveSalary(db, payslip.employeeId, period);
    if (basisId === null || !current || current.id === basisId) continue;
    const basis = db.select().from(employeeSalaries).where(eq(employeeSalaries.id, basisId)).get();
    if (!basis) continue;
    const before = computeWith(db, basis, payslip.variables);
    const after = computeWith(db, current, payslip.variables);
    const month = formatDate(`${period}-01`, { month: "short", year: "numeric" });
    if (before.errors.length || after.errors.length) {
      warnings.push(`Arrears for ${payslip.snapshot.name} (${month}) can't be computed: ${[...before.errors, ...after.errors][0]}`);
      continue;
    }
    const amounts = (result: PayslipCalcResult) =>
      new Map(result.lines.filter((l) => l.source === "component").map((l) => [l.code, { name: l.name, amount: l.amount }]));
    const was = amounts(before);
    const now = amounts(after);
    for (const code of new Set([...now.keys(), ...was.keys()])) {
      const difference = (now.get(code)?.amount ?? 0) - (was.get(code)?.amount ?? 0);
      const component = componentByCode(db, code);
      if (difference === 0 || !component) continue;
      inputs.push({
        employeeId: payslip.employeeId, componentId: component.id, amount: difference,
        label: `Arrears – ${(now.get(code) ?? was.get(code))!.name} (${month})`, sourceId: payslip.id, salaryId: current.id,
      });
    }
  }
  return { inputs, warnings };
}

/** On approval: the earlier payslips this run pays arrears for are now paid up to the new salary. */
export function settleArrears(db: DbLike, runId: number, employeeIds: readonly number[]): void {
  if (!employeeIds.length) return;
  const rows = db
    .select()
    .from(payrollInputs)
    .where(and(eq(payrollInputs.runId, runId), eq(payrollInputs.source, "arrear"), inArray(payrollInputs.employeeId, [...employeeIds])))
    .all();
  for (const input of rows) {
    if (input.sourceId === null) continue;
    db.update(payslips).set({ paidBasisSalaryId: input.salaryId }).where(eq(payslips.id, input.sourceId)).run();
  }
}

/** On revert: each earlier payslip goes back to the salary the latest other approved run paid it up to, or none. */
export function unsettleArrears(db: DbLike, runId: number): void {
  const rows = db.select().from(payrollInputs).where(and(eq(payrollInputs.runId, runId), eq(payrollInputs.source, "arrear"))).all();
  for (const payslipId of new Set(rows.flatMap((r) => (r.sourceId === null ? [] : [r.sourceId])))) {
    const other = db
      .select({ salaryId: payrollInputs.salaryId })
      .from(payrollInputs)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payrollInputs.runId))
      .where(
        and(
          eq(payrollInputs.source, "arrear"),
          eq(payrollInputs.sourceId, payslipId),
          ne(payrollInputs.runId, runId),
          inArray(payrollRuns.status, CLOSED_RUN_STATUSES),
        ),
      )
      .orderBy(asc(payrollRuns.period))
      .all()
      .at(-1);
    db.update(payslips).set({ paidBasisSalaryId: other?.salaryId ?? null }).where(eq(payslips.id, payslipId)).run();
  }
}
