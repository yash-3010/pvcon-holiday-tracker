import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, ne, notInArray, sql } from "drizzle-orm";
import { addMonths, formatPeriod, monthRange, periodOf, type ISODate } from "@/lib/dates";
import { calculatePayslip, type CalcComponent, type CalcInput } from "@/lib/payroll/calculate";
import { CLOSED_RUN_STATUSES, type PayslipStatus, type RunType } from "@/lib/payroll/constants";
import type { DbLike } from "@/server/db/client";
import {
  attendanceDays, compOffClaims, departments, designations, employees, expenseClaims, loanRepayments, loans, payrollInputs, payrollRuns,
  payslipLines, payslips, salaryComponents, salaryStructures, type EmployeeRow, type EmployeeSalaryRow, type PayrollRunRow, type PayslipRow,
  type PayslipSnapshot,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { fillMissingAttendance } from "@/server/modules/attendance/compute";
import { bankView } from "@/server/modules/employees/sensitive";
import { notify } from "@/server/modules/notifications/service";
import { assertEditable, employedInPeriod, loanOutstanding, refreshSystemInputs, requireRun } from "./inputs";
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

/** Requires the run to be in `status`. Released and paid runs are immutable (RUN_LOCKED). */
function assertStatus(run: PayrollRunRow, status: PayrollRunRow["status"], code: string, message: string): void {
  if (run.status === status) return;
  if (["released", "paid"].includes(run.status)) {
    throw new DomainError("RUN_LOCKED", "Released runs never change; correct them through the next period's inputs.");
  }
  throw new DomainError(code, message);
}

function runPayslips(db: DbLike, runId: number): PayslipRow[] {
  return db.select().from(payslips).where(eq(payslips.runId, runId)).all();
}

/** Comp-off payout claims a payslip counted: approved for payout, unpaid, and decided by the period end and the compute. */
function compOffPayoutsFor(run: PayrollRunRow, employeeIds: number[]) {
  const { end } = monthRange(run.period);
  return and(
    inArray(compOffClaims.employeeId, employeeIds),
    eq(compOffClaims.status, "approved"),
    eq(compOffClaims.resolution, "payout"),
    isNull(compOffClaims.paidRunId),
    lte(compOffClaims.decidedAt, run.computedAt ?? ""),
    lte(sql`substr(${compOffClaims.decidedAt}, 1, 10)`, end),
  );
}

/**
 * Approves a computed run (spec §5.6 run step 5): by someone other than the person who computed it, with no payslip
 * errors. For every included or held payslip it locks the period's attendance, marks the run's expense claims paid,
 * writes loan repayments (closing repaid loans) and marks the comp-off payouts paid.
 */
export function approveRun(
  db: DbLike,
  actorUserId: number,
  runId: number,
  { now }: { now: Date },
): PayrollRunRow {
  const run = requireRun(db, runId);
  if (run.status === "draft") throw new DomainError("NOT_COMPUTED", "Compute the run first.");
  assertStatus(run, "computed", "RUN_LOCKED", `This run is ${run.status}.`);
  if (run.computedBy === actorUserId) {
    throw new DomainError("SAME_PERSON", "Someone other than the person who computed the run must approve it.");
  }
  const all = runPayslips(db, run.id);
  const errors = all.filter((p) => p.error).length;
  if (errors) throw new DomainError("PAYSLIP_ERRORS", `${errors} payslip(s) have errors. Fix them and compute again.`);
  const paid = all.filter((p) => p.status !== "excluded");
  const paidIds = paid.map((p) => p.employeeId);

  if (run.type === "regular" && paidIds.length) {
    const { start, end } = monthRange(run.period);
    fillMissingAttendance(db, start, end, { now });
    db.update(attendanceDays)
      .set({ locked: true })
      .where(and(inArray(attendanceDays.employeeId, paidIds), gte(attendanceDays.date, start), lte(attendanceDays.date, end)))
      .run();
    db.update(compOffClaims).set({ paidRunId: run.id }).where(compOffPayoutsFor(run, paidIds)).run();
  }

  const inputs = paidIds.length
    ? db.select().from(payrollInputs).where(and(eq(payrollInputs.runId, run.id), inArray(payrollInputs.employeeId, paidIds))).orderBy(asc(payrollInputs.id)).all()
    : [];
  const claimIds = inputs.filter((i) => i.source === "claim" && i.sourceId !== null).map((i) => i.sourceId!);
  if (claimIds.length) {
    db.update(expenseClaims).set({ status: "paid", paidRunId: run.id, financeBy: actorUserId }).where(inArray(expenseClaims.id, claimIds)).run();
  }
  for (const payslip of paid) {
    // Loan lines follow the loan inputs' order; their amounts are what was deducted after any capping.
    const loanInputs = inputs.filter((i) => i.employeeId === payslip.employeeId && i.source === "loan");
    if (!loanInputs.length) continue;
    const lines = db
      .select()
      .from(payslipLines)
      .where(and(eq(payslipLines.payslipId, payslip.id), eq(payslipLines.source, "loan")))
      .orderBy(asc(payslipLines.sortOrder))
      .all();
    loanInputs.forEach((input, i) => {
      const amount = lines[i]?.amount ?? 0;
      if (amount <= 0) return;
      const loan = db.select().from(loans).where(eq(loans.id, input.sourceId!)).get();
      if (!loan) return;
      db.insert(loanRepayments).values({ loanId: loan.id, runId: run.id, payslipId: payslip.id, period: run.period, amount }).run();
      if (loanOutstanding(db, loan.id, loan.principal) === 0) db.update(loans).set({ status: "closed" }).where(eq(loans.id, loan.id)).run();
    });
  }

  return db
    .update(payrollRuns)
    .set({ status: "approved", approvedBy: actorUserId, approvedAt: now.toISOString() })
    .where(eq(payrollRuns.id, run.id))
    .returning()
    .get()!;
}

/**
 * Takes an approved run back to computed (spec §5.6 "Revert"): unlocks its attendance, puts its claims back to
 * approved, deletes its loan repayments (reopening loans they closed) and unmarks its comp-off payouts. Not once a later
 * regular run exists.
 */
export function revertRun(db: DbLike, runId: number): PayrollRunRow {
  const run = requireRun(db, runId);
  assertStatus(run, "approved", "NOT_APPROVED", "Only an approved run can be reverted.");
  if (run.type === "regular") {
    const later = db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.type, "regular"), LIVE, gt(payrollRuns.period, run.period)))
      .get();
    if (later) throw new DomainError("LATER_RUN", `Cancel the ${formatPeriod(later.period)} run first.`);
    const employeeIds = runPayslips(db, run.id).map((p) => p.employeeId);
    if (employeeIds.length) {
      const { start, end } = monthRange(run.period);
      db.update(attendanceDays)
        .set({ locked: false })
        .where(and(inArray(attendanceDays.employeeId, employeeIds), gte(attendanceDays.date, start), lte(attendanceDays.date, end)))
        .run();
    }
  }
  db.update(expenseClaims).set({ status: "approved", paidRunId: null, financeBy: null }).where(eq(expenseClaims.paidRunId, run.id)).run();
  db.update(compOffClaims).set({ paidRunId: null }).where(eq(compOffClaims.paidRunId, run.id)).run();
  const repaid = db.select().from(loanRepayments).where(eq(loanRepayments.runId, run.id)).all();
  db.delete(loanRepayments).where(eq(loanRepayments.runId, run.id)).run();
  for (const loanId of new Set(repaid.map((r) => r.loanId))) {
    const loan = db.select().from(loans).where(eq(loans.id, loanId)).get();
    if (loan?.status === "closed" && loanOutstanding(db, loan.id, loan.principal) > 0) {
      db.update(loans).set({ status: "active" }).where(eq(loans.id, loan.id)).run();
    }
  }
  return db
    .update(payrollRuns)
    .set({ status: "computed", approvedBy: null, approvedAt: null })
    .where(eq(payrollRuns.id, run.id))
    .returning()
    .get()!;
}

function notifyReleased(db: DbLike, payslip: PayslipRow, period: string): void {
  const userId = db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, payslip.employeeId)).get()?.userId;
  if (!userId) return;
  notify(db, { userId, type: "payslip_released", title: `Your payslip for ${formatPeriod(period)} is ready`, link: `/me/payslips/${payslip.id}` });
}

/** Releases an approved run (spec §5.6 run step 6): its included payslips become visible to employees. Held ones wait. */
export function releaseRun(db: DbLike, runId: number, { now }: { now: Date }): { run: PayrollRunRow; payslipIds: number[] } {
  const run = requireRun(db, runId);
  if (run.status !== "approved") throw new DomainError("NOT_APPROVED", "Approve the run before releasing it.");
  const at = now.toISOString();
  const released = runPayslips(db, run.id).filter((p) => p.status === "ok");
  for (const payslip of released) {
    db.update(payslips).set({ releasedAt: at }).where(eq(payslips.id, payslip.id)).run();
    notifyReleased(db, payslip, run.period);
  }
  const updated = db.update(payrollRuns).set({ status: "released", releasedAt: at }).where(eq(payrollRuns.id, run.id)).returning().get()!;
  return { run: updated, payslipIds: released.map((p) => p.id) };
}

/** Releases a payslip held when its run was released. */
export function releasePayslip(db: DbLike, payslipId: number, { now }: { now: Date }): PayslipRow {
  const payslip = db.select().from(payslips).where(eq(payslips.id, payslipId)).get();
  if (!payslip) throw new DomainError("NOT_FOUND", "Payslip not found.");
  const run = requireRun(db, payslip.runId);
  if (payslip.status !== "hold" || payslip.releasedAt) throw new DomainError("NOT_HELD", "Only a held payslip can be released on its own.");
  if (run.status !== "released" && run.status !== "paid") throw new DomainError("NOT_RELEASED", "Release the run first.");
  const updated = db.update(payslips).set({ status: "ok", releasedAt: now.toISOString() }).where(eq(payslips.id, payslip.id)).returning().get()!;
  notifyReleased(db, updated, run.period);
  return updated;
}

/** Records the bank payment of a released run (spec §5.6 run step 7). */
export function markPaid(
  db: DbLike,
  runId: number,
  { paidOn, reference }: { paidOn: ISODate; reference: string | null },
  { now }: { now: Date },
): PayrollRunRow {
  const run = requireRun(db, runId);
  if (run.status !== "released") throw new DomainError("NOT_RELEASED", "Release the run before marking it paid.");
  return db
    .update(payrollRuns)
    .set({ status: "paid", paidOn, paymentRef: reference, paidAt: now.toISOString() })
    .where(eq(payrollRuns.id, run.id))
    .returning()
    .get()!;
}

/** Cancels a run that isn't approved yet; its payslips go, its inputs stay for the record. */
export function cancelRun(db: DbLike, runId: number): PayrollRunRow {
  const run = requireRun(db, runId);
  assertEditable(run);
  db.delete(payslips).where(eq(payslips.runId, run.id)).run();
  return db.update(payrollRuns).set({ status: "cancelled" }).where(eq(payrollRuns.id, run.id)).returning().get()!;
}
