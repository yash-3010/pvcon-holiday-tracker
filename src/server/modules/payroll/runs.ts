import { and, eq, gt, inArray, lt, ne, notInArray } from "drizzle-orm";
import { addMonths, formatPeriod, periodOf, type ISODate } from "@/lib/dates";
import { calculatePayslip, type CalcComponent, type CalcInput } from "@/lib/payroll/calculate";
import { CLOSED_RUN_STATUSES, type PayslipStatus, type RunType } from "@/lib/payroll/constants";
import type { DbLike } from "@/server/db/client";
import {
  departments, designations, employees, payrollInputs, payrollRuns, payslipLines, payslips, salaryComponents, salaryStructures,
  type EmployeeRow, type EmployeeSalaryRow, type PayrollRunRow, type PayslipRow, type PayslipSnapshot,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { bankView } from "@/server/modules/employees/sensitive";
import { assertEditable, employedInPeriod, refreshSystemInputs, requireRun } from "./inputs";
import { periodVariables } from "./period";
import { effectiveSalary } from "./salaries";
import { applyOverrides, structureComponents } from "./structures";

export { requireRun } from "./inputs";

const LIVE = ne(payrollRuns.status, "cancelled");

/**
 * Creates a draft run (spec §5.6 run step 1). Regular runs: one per period, in order, and the previous period must be
 * approved first, except for the very first run. Any run: at most a month ahead of today.
 */
export function createRun(
  db: DbLike,
  actorUserId: number,
  input: { period: string; type: RunType; notes: string | null },
  { today }: { today: ISODate },
): PayrollRunRow {
  if (input.period > addMonths(periodOf(today), 1)) {
    throw new DomainError("TOO_EARLY", "A run can be at most a month ahead.", { period: ["Too far ahead"] });
  }
  if (input.type === "regular") {
    const regular = and(eq(payrollRuns.type, "regular"), LIVE);
    if (db.select({ id: payrollRuns.id }).from(payrollRuns).where(and(regular, eq(payrollRuns.period, input.period))).get()) {
      throw new DomainError("DUPLICATE_RUN", `${formatPeriod(input.period)} already has a regular run.`, { period: ["Already has a run"] });
    }
    if (db.select({ id: payrollRuns.id }).from(payrollRuns).where(and(regular, gt(payrollRuns.period, input.period))).get()) {
      throw new DomainError("OUT_OF_ORDER", "A later period already has a regular run.", { period: ["A later period has a run"] });
    }
    if (db.select({ id: payrollRuns.id }).from(payrollRuns).where(and(regular, lt(payrollRuns.period, input.period))).get()) {
      const previousPeriod = addMonths(input.period, -1);
      const previous = db.select().from(payrollRuns).where(and(regular, eq(payrollRuns.period, previousPeriod))).get();
      if (!previous || !CLOSED_RUN_STATUSES.includes(previous.status)) {
        throw new DomainError("PREVIOUS_OPEN", `Approve the ${formatPeriod(previousPeriod)} run first.`, { period: ["The previous period is open"] });
      }
    }
  }
  return db.insert(payrollRuns).values({ ...input, createdBy: actorUserId }).returning().get();
}

function snapshotOf(db: DbLike, employee: EmployeeRow, salary: EmployeeSalaryRow | undefined): PayslipSnapshot {
  const bank = bankView(employee, false);
  const department = employee.departmentId
    ? db.select({ name: departments.name }).from(departments).where(eq(departments.id, employee.departmentId)).get()?.name
    : null;
  const designation = employee.designationId
    ? db.select({ name: designations.name }).from(designations).where(eq(designations.id, employee.designationId)).get()?.name
    : null;
  const structure = salary
    ? db.select({ name: salaryStructures.name }).from(salaryStructures).where(eq(salaryStructures.id, salary.structureId)).get()?.name
    : null;
  return {
    name: employee.displayName, code: employee.employeeCode, designation: designation ?? null, department: department ?? null,
    dateOfJoining: employee.dateOfJoining, bankName: bank.bankName, bankAccountMasked: bank.bankAccount, bankIfsc: bank.bankIfsc,
    pan: bank.pan, annualCtc: salary?.annualCtc ?? 0, structure: structure ?? "",
  };
}

interface Computed {
  salary: EmployeeSalaryRow | undefined;
  components: CalcComponent[];
  variables: Record<string, number> & { TOTAL_DAYS: number; PAID_DAYS: number };
}

/** Writes one payslip and its lines. A hold or manual exclusion survives; an error excludes it until it computes. */
function writePayslip(db: DbLike, run: PayrollRunRow, employee: EmployeeRow, { salary, components, variables }: Computed, inputs: CalcInput[]): void {
  const result = calculatePayslip({ annualCtc: salary?.annualCtc ?? 0, components, variables, inputs });
  const snapshot = snapshotOf(db, employee, salary);
  const error = result.errors[0] ?? null;
  const warnings = error ? [error] : [...result.warnings];
  if (!error && run.type === "regular") {
    if (!snapshot.bankAccountMasked) warnings.unshift("No bank account");
    else if (!snapshot.bankIfsc) warnings.unshift("No IFSC");
    if (variables.PAID_DAYS === 0) warnings.push("No paid days");
  }
  const existing = db.select().from(payslips).where(and(eq(payslips.runId, run.id), eq(payslips.employeeId, employee.id))).get();
  let status: PayslipStatus = existing?.status ?? "ok";
  if (error) status = "excluded";
  else if (existing?.error && status === "excluded") status = "ok";

  const values = {
    // Off-cycle payslips use the salary for the snapshot only.
    status, salaryId: run.type === "regular" ? (salary?.id ?? null) : null, paidBasisSalaryId: null, snapshot, variables,
    totalDays: variables.TOTAL_DAYS, workingDays: variables.WORKING_DAYS ?? 0, paidDays: variables.PAID_DAYS, lopDays: variables.LOP_DAYS ?? 0,
    grossEarnings: result.grossEarnings, totalDeductions: result.totalDeductions, employerContributions: result.employerContributions,
    reimbursements: result.reimbursements, netPay: result.netPay, warnings, error,
  };
  const payslip = existing
    ? db.update(payslips).set(values).where(eq(payslips.id, existing.id)).returning().get()!
    : db.insert(payslips).values({ runId: run.id, employeeId: employee.id, ...values }).returning().get();
  db.delete(payslipLines).where(eq(payslipLines.payslipId, payslip.id)).run();
  for (const line of result.lines) {
    db.insert(payslipLines).values({
      payslipId: payslip.id, componentCode: line.code, componentName: line.name, kind: line.kind, amount: line.amount, rateAmount: line.rate,
      explanation: line.explanation, source: line.source, showOnPayslip: line.showOnPayslip, sortOrder: line.sortOrder,
    }).run();
  }
}

function runInputs(db: DbLike, runId: number): Map<number, CalcInput[]> {
  const rows = db
    .select({ input: payrollInputs, code: salaryComponents.code, kind: salaryComponents.kind })
    .from(payrollInputs)
    .innerJoin(salaryComponents, eq(salaryComponents.id, payrollInputs.componentId))
    .where(eq(payrollInputs.runId, runId))
    .orderBy(payrollInputs.id)
    .all();
  const byEmployee = new Map<number, CalcInput[]>();
  for (const { input, code, kind } of rows) {
    const list = byEmployee.get(input.employeeId) ?? [];
    list.push({ code, kind, amount: input.amount, label: input.label, source: input.source });
    byEmployee.set(input.employeeId, list);
  }
  return byEmployee;
}

/**
 * Computes a draft or computed run (spec §5.6 run step 3). Regular runs: every employee employed on some day of the
 * period with an effective salary gets a payslip from the structure, their overrides, the period's attendance and the
 * run's inputs; an employee without a salary becomes a run warning. Off-cycle runs: a payslip of inputs only for each
 * employee with inputs. Payslips of employees no longer in the run are deleted.
 */
export function computeRun(
  db: DbLike,
  actorUserId: number,
  runId: number,
  { today, now }: { today: ISODate; now: Date },
): { run: PayrollRunRow; payslips: number } {
  const run = requireRun(db, runId);
  assertEditable(run);
  refreshSystemInputs(db, run);
  const inputs = runInputs(db, run.id);
  const warnings: string[] = [];
  const paid: number[] = [];

  const employeeIds = run.type === "regular" ? [...employedInPeriod(db, run.period)] : [...inputs.keys()];
  const people = employeeIds.length
    ? db.select().from(employees).where(inArray(employees.id, employeeIds)).orderBy(employees.employeeCode).all()
    : [];
  for (const employee of people) {
    const salary = effectiveSalary(db, employee.id, run.period);
    if (run.type === "regular") {
      if (!salary) {
        warnings.push(`No salary for ${employee.displayName}`);
        continue;
      }
      const variables = periodVariables(db, employee, run.period, { today, now });
      const components = applyOverrides(structureComponents(db, salary.structureId), salary.overrides);
      writePayslip(db, run, employee, { salary, components, variables }, inputs.get(employee.id) ?? []);
    } else {
      writePayslip(db, run, employee, { salary, components: [], variables: { TOTAL_DAYS: 0, PAID_DAYS: 0 } }, inputs.get(employee.id) ?? []);
    }
    paid.push(employee.id);
  }

  db.delete(payslips).where(and(eq(payslips.runId, run.id), paid.length ? notInArray(payslips.employeeId, paid) : undefined)).run();
  const updated = db
    .update(payrollRuns)
    .set({ status: "computed", computedBy: actorUserId, computedAt: now.toISOString(), warnings })
    .where(eq(payrollRuns.id, run.id))
    .returning()
    .get()!;
  return { run: updated, payslips: paid.length };
}

/** Holds or excludes a payslip, or includes it again, before approval. A payslip with an error stays excluded. */
export function setPayslipStatus(db: DbLike, runId: number, employeeId: number, status: PayslipStatus): PayslipRow {
  assertEditable(requireRun(db, runId));
  const payslip = db.select().from(payslips).where(and(eq(payslips.runId, runId), eq(payslips.employeeId, employeeId))).get();
  if (!payslip) throw new DomainError("NOT_FOUND", "Payslip not found.");
  if (status !== "excluded" && payslip.error) throw new DomainError("PAYSLIP_ERROR", `Fix the error first: ${payslip.error}`);
  return db.update(payslips).set({ status }).where(eq(payslips.id, payslip.id)).returning().get()!;
}
