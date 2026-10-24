import { and, desc, eq, inArray, lte, or } from "drizzle-orm";
import type { Minor } from "@/lib/money";
import { CLOSED_RUN_STATUSES } from "@/lib/payroll/constants";
import type { SalaryInput } from "@/lib/validation/payroll";
import type { DbLike } from "@/server/db/client";
import { employeeSalaries, payrollInputs, payrollRuns, payslips, type EmployeeSalaryRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { recordEmployeeEvent, requireEmployee } from "@/server/modules/employees/service";
import { requireStructure, structureComponents, structurePreview } from "./structures";

const LATEST_FIRST = [desc(employeeSalaries.effectiveFrom), desc(employeeSalaries.id)] as const;

/** The salary for a pay period: the latest revision effective on or before its 1st (the later of two for a month). */
export function effectiveSalary(db: DbLike, employeeId: number, period: string): EmployeeSalaryRow | undefined {
  return db
    .select()
    .from(employeeSalaries)
    .where(and(eq(employeeSalaries.employeeId, employeeId), lte(employeeSalaries.effectiveFrom, `${period}-01`)))
    .orderBy(...LATEST_FIRST)
    .get();
}

/** Every revision, latest first. A row followed by a later one for the same month was corrected by it. */
export function salaryHistory(db: DbLike, employeeId: number): EmployeeSalaryRow[] {
  return db.select().from(employeeSalaries).where(eq(employeeSalaries.employeeId, employeeId)).orderBy(...LATEST_FIRST).all();
}

/** Whether an approved, released or paid payslip was computed with the revision, or brought up to it by arrears. */
function usedByPayroll(db: DbLike, salaryId: number): boolean {
  const closed = inArray(payrollRuns.status, CLOSED_RUN_STATUSES);
  const payslip = db
    .select({ id: payslips.id })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .where(and(closed, or(eq(payslips.salaryId, salaryId), eq(payslips.paidBasisSalaryId, salaryId))))
    .get();
  const arrear = db
    .select({ id: payrollInputs.id })
    .from(payrollInputs)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payrollInputs.runId))
    .where(and(closed, eq(payrollInputs.salaryId, salaryId)))
    .get();
  return !!payslip || !!arrear;
}

export interface SalaryPreview {
  lines: { code: string; name: string; kind: string; monthly: Minor; annual: Minor }[];
  grossMonthly: Minor;
  deductionsMonthly: Minor;
  employerMonthly: Minor;
  netMonthly: Minor;
  warnings: string[];
  errors: string[];
}

/** A full month and its annual equivalent, before saving a revision. */
export function salaryPreview(
  db: DbLike,
  { structureId, annualCtc, overrides }: { structureId: number; annualCtc: Minor; overrides: Readonly<Record<string, number | string>> },
): SalaryPreview {
  const result = structurePreview(db, structureComponents(db, structureId), annualCtc, overrides);
  return {
    lines: result.lines.map((l) => ({ code: l.code, name: l.name, kind: l.kind, monthly: l.amount, annual: l.amount * 12 })),
    grossMonthly: result.grossEarnings,
    deductionsMonthly: result.totalDeductions,
    employerMonthly: result.employerContributions,
    netMonthly: result.netPay,
    warnings: result.warnings,
    errors: result.errors,
  };
}

/**
 * Saves a revision effective from the 1st of a month (spec §5.6); one for the same month replaces it. Overrides must
 * name components of the structure, and the result must compute. Records a `salary_revised` event.
 */
export function reviseSalary(db: DbLike, actorUserId: number, input: SalaryInput): EmployeeSalaryRow {
  const employee = requireEmployee(db, input.employeeId);
  if (employee.status === "exited") throw new DomainError("NOT_CURRENT", "This employee has left.");
  if (input.effectiveFrom < `${employee.dateOfJoining.slice(0, 7)}-01`) {
    throw new DomainError("BEFORE_JOINING", "A salary can't start before the month the employee joined.", { effectiveFrom: ["Before joining"] });
  }
  const structure = requireStructure(db, input.structureId);
  if (structure.archived) throw new DomainError("ARCHIVED", "Choose an active structure.", { structureId: ["Archived"] });
  const codes = new Set(structureComponents(db, structure.id).map((c) => c.code));
  const unknown = Object.keys(input.overrides).find((code) => !codes.has(code));
  if (unknown) throw new DomainError("UNKNOWN_COMPONENT", `${unknown} is not in the ${structure.name} structure.`, { overrides: [`${unknown} is not in the structure`] });
  const preview = salaryPreview(db, input);
  if (preview.errors.length) throw new DomainError("INVALID_SALARY", preview.errors[0]!, { overrides: preview.errors });

  const previous = db
    .select()
    .from(employeeSalaries)
    .where(and(eq(employeeSalaries.employeeId, employee.id), lte(employeeSalaries.effectiveFrom, input.effectiveFrom)))
    .orderBy(...LATEST_FIRST)
    .all()
    .find((s) => s.effectiveFrom !== input.effectiveFrom);
  const values = {
    annualCtc: input.annualCtc, structureId: input.structureId, overrides: input.overrides, reason: input.reason,
    createdBy: actorUserId, approvedBy: actorUserId,
  };
  // A revision for the same month replaces it, unless payroll has used it: then the new row corrects it (arrears).
  const sameMonth = db
    .select()
    .from(employeeSalaries)
    .where(and(eq(employeeSalaries.employeeId, employee.id), eq(employeeSalaries.effectiveFrom, input.effectiveFrom)))
    .orderBy(desc(employeeSalaries.id))
    .get();
  const saved =
    sameMonth && !usedByPayroll(db, sameMonth.id)
      ? db.update(employeeSalaries).set(values).where(eq(employeeSalaries.id, sameMonth.id)).returning().get()!
      : db.insert(employeeSalaries).values({ employeeId: employee.id, effectiveFrom: input.effectiveFrom, ...values }).returning().get();
  recordEmployeeEvent(db, {
    employeeId: employee.id, type: "salary_revised", effectiveDate: input.effectiveFrom,
    from: previous ? { annualCtc: previous.annualCtc } : null, to: { annualCtc: input.annualCtc }, note: input.reason, createdBy: actorUserId,
  });
  return saved;
}
