import { and, desc, eq, lte } from "drizzle-orm";
import type { Minor } from "@/lib/money";
import type { SalaryInput } from "@/lib/validation/payroll";
import type { DbLike } from "@/server/db/client";
import { employeeSalaries, type EmployeeSalaryRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { recordEmployeeEvent, requireEmployee } from "@/server/modules/employees/service";
import { requireStructure, structureComponents, structurePreview } from "./structures";

/** The salary for a pay period: the latest revision effective on or before its 1st. */
export function effectiveSalary(db: DbLike, employeeId: number, period: string): EmployeeSalaryRow | undefined {
  return db
    .select()
    .from(employeeSalaries)
    .where(and(eq(employeeSalaries.employeeId, employeeId), lte(employeeSalaries.effectiveFrom, `${period}-01`)))
    .orderBy(desc(employeeSalaries.effectiveFrom))
    .get();
}

export function salaryHistory(db: DbLike, employeeId: number): EmployeeSalaryRow[] {
  return db.select().from(employeeSalaries).where(eq(employeeSalaries.employeeId, employeeId)).orderBy(desc(employeeSalaries.effectiveFrom)).all();
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
    .orderBy(desc(employeeSalaries.effectiveFrom))
    .all()
    .find((s) => s.effectiveFrom !== input.effectiveFrom);
  const values = {
    annualCtc: input.annualCtc, structureId: input.structureId, overrides: input.overrides, reason: input.reason,
    createdBy: actorUserId, approvedBy: actorUserId,
  };
  const saved = db
    .insert(employeeSalaries)
    .values({ employeeId: employee.id, effectiveFrom: input.effectiveFrom, ...values })
    .onConflictDoUpdate({ target: [employeeSalaries.employeeId, employeeSalaries.effectiveFrom], set: values })
    .returning()
    .get();
  recordEmployeeEvent(db, {
    employeeId: employee.id, type: "salary_revised", effectiveDate: input.effectiveFrom,
    from: previous ? { annualCtc: previous.annualCtc } : null, to: { annualCtc: input.annualCtc }, note: input.reason, createdBy: actorUserId,
  });
  return saved;
}
