import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, type SQL } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import { addMonths, fiscalYearOf, type ISODate } from "@/lib/dates";
import type { Minor } from "@/lib/money";
import type { CalcComponent } from "@/lib/payroll/calculate";
import {
  type ClaimStatus, type ComponentKind, type InputSource, type LoanStatus, type PayslipStatus, type RunStatus, type RunType,
} from "@/lib/payroll/constants";
import type { DbLike } from "@/server/db/client";
import {
  employees, employeeSalaries, expenseClaims, loanRepayments, loans, payrollInputs, payrollRuns, payslipLines, payslips, payslipVerifications,
  salaryComponents, salaryStructures, users, type ExpenseClaimRow, type LoanRow, type PayrollRunRow, type PayslipRow,
} from "@/server/db/schema";
import type { ScopeUser } from "@/server/modules/employees/scope";
import { getSetting } from "@/server/modules/settings/service";
import { canDecideClaim } from "./claims";
import { salaryPreview } from "./salaries";
import { structureComponents } from "./structures";

export interface RunListItem {
  id: number;
  period: string;
  type: RunType;
  status: RunStatus;
  payslips: number;
  netPay: Minor;
  computedAt: string | null;
  approvedAt: string | null;
  releasedAt: string | null;
}

/** Runs, latest first, with the payslip count and net pay of included and held payslips. */
export function listRuns(db: DbLike): RunListItem[] {
  const runs = db.select().from(payrollRuns).orderBy(desc(payrollRuns.period), desc(payrollRuns.id)).all();
  const slips = db.select({ runId: payslips.runId, status: payslips.status, netPay: payslips.netPay }).from(payslips).all();
  return runs.map((r) => {
    const mine = slips.filter((p) => p.runId === r.id && p.status !== "excluded");
    return {
      id: r.id, period: r.period, type: r.type, status: r.status, payslips: mine.length, netPay: mine.reduce((s, p) => s + p.netPay, 0),
      computedAt: r.computedAt, approvedAt: r.approvedAt, releasedAt: r.releasedAt,
    };
  });
}

export interface RegisterRow {
  payslipId: number;
  employeeId: number;
  code: string;
  name: string;
  status: PayslipStatus;
  paidDays: number;
  lopDays: number;
  grossEarnings: Minor;
  totalDeductions: Minor;
  employerContributions: Minor;
  netPay: Minor;
  warnings: string[];
  error: string | null;
  releasedAt: string | null;
  /** Net pay in the previous period's regular run, when there was one. */
  previousNetPay: Minor | null;
  variancePct: number | null;
  /** The change exceeds `payroll.varianceThresholdPct`. */
  flagged: boolean;
}

export interface RunInputItem {
  id: number;
  employeeId: number;
  employeeName: string;
  componentCode: string;
  componentName: string;
  amount: Minor;
  label: string;
  note: string | null;
  source: InputSource;
}

export interface RunDetail {
  run: PayrollRunRow;
  createdByName: string | null;
  computedByName: string | null;
  approvedByName: string | null;
  rows: RegisterRow[];
  inputs: RunInputItem[];
  totals: { grossEarnings: Minor; totalDeductions: Minor; employerContributions: Minor; netPay: Minor; included: number; held: number; excluded: number };
}

const userName = (db: DbLike, id: number | null) => (id ? (db.select({ name: users.name }).from(users).where(eq(users.id, id)).get()?.name ?? null) : null);

/** The review screen of a run (spec §5.6 run step 4): register with variance flags, inputs and totals. */
export function runDetail(db: DbLike, runId: number): RunDetail | null {
  const run = db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).get();
  if (!run) return null;
  const threshold = getSetting(db, "payroll").varianceThresholdPct;
  const slips = db
    .select({ payslip: payslips, code: employees.employeeCode, name: employees.displayName })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(eq(payslips.runId, run.id))
    .orderBy(asc(employees.employeeCode))
    .all();
  const previousRun =
    run.type === "regular"
      ? db
          .select()
          .from(payrollRuns)
          .where(and(eq(payrollRuns.type, "regular"), eq(payrollRuns.period, addMonths(run.period, -1)), ne(payrollRuns.status, "cancelled")))
          .get()
      : undefined;
  const previous = new Map(
    previousRun
      ? db
          .select({ employeeId: payslips.employeeId, netPay: payslips.netPay })
          .from(payslips)
          .where(and(eq(payslips.runId, previousRun.id), ne(payslips.status, "excluded")))
          .all()
          .map((p) => [p.employeeId, p.netPay])
      : [],
  );
  const rows = slips.map(({ payslip: p, code, name }): RegisterRow => {
    const before = previous.get(p.employeeId) ?? null;
    const variancePct = before ? Math.round(((p.netPay - before) / before) * 1000) / 10 : null;
    return {
      payslipId: p.id, employeeId: p.employeeId, code, name, status: p.status, paidDays: p.paidDays, lopDays: p.lopDays,
      grossEarnings: p.grossEarnings, totalDeductions: p.totalDeductions, employerContributions: p.employerContributions, netPay: p.netPay,
      warnings: p.warnings, error: p.error, releasedAt: p.releasedAt, previousNetPay: before, variancePct,
      flagged: variancePct !== null && Math.abs(variancePct) > threshold,
    };
  });
  const inputs = db
    .select({ input: payrollInputs, employeeName: employees.displayName, componentCode: salaryComponents.code, componentName: salaryComponents.name })
    .from(payrollInputs)
    .innerJoin(employees, eq(employees.id, payrollInputs.employeeId))
    .innerJoin(salaryComponents, eq(salaryComponents.id, payrollInputs.componentId))
    .where(eq(payrollInputs.runId, run.id))
    .orderBy(asc(employees.employeeCode), asc(payrollInputs.id))
    .all()
    .map(({ input: i, employeeName, componentCode, componentName }) => ({
      id: i.id, employeeId: i.employeeId, employeeName, componentCode, componentName, amount: i.amount, label: i.label, note: i.note, source: i.source,
    }));
  const paid = rows.filter((r) => r.status !== "excluded");
  const sum = (pick: (r: RegisterRow) => Minor) => paid.reduce((s, r) => s + pick(r), 0);
  return {
    run, createdByName: userName(db, run.createdBy), computedByName: userName(db, run.computedBy), approvedByName: userName(db, run.approvedBy),
    rows, inputs,
    totals: {
      grossEarnings: sum((r) => r.grossEarnings), totalDeductions: sum((r) => r.totalDeductions), employerContributions: sum((r) => r.employerContributions),
      netPay: sum((r) => r.netPay), included: rows.filter((r) => r.status === "ok").length, held: rows.filter((r) => r.status === "hold").length,
      excluded: rows.filter((r) => r.status === "excluded").length,
    },
  };
}

export interface PayslipDetail {
  payslip: PayslipRow;
  period: string;
  runType: RunType;
  runStatus: RunStatus;
  lines: { code: string; name: string; kind: ComponentKind; amount: Minor; rate: Minor | null; explanation: string | null; source: string; showOnPayslip: boolean }[];
}

/** A payslip with its lines and their explanations, for the drill-down and My payslips. Callers check access. */
export function payslipDetail(db: DbLike, payslipId: number): PayslipDetail | null {
  const row = db
    .select({ payslip: payslips, period: payrollRuns.period, runType: payrollRuns.type, runStatus: payrollRuns.status })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .where(eq(payslips.id, payslipId))
    .get();
  if (!row) return null;
  const lines = db
    .select()
    .from(payslipLines)
    .where(eq(payslipLines.payslipId, payslipId))
    .orderBy(asc(payslipLines.sortOrder))
    .all()
    .map((l) => ({
      code: l.componentCode, name: l.componentName, kind: l.kind, amount: l.amount, rate: l.rateAmount, explanation: l.explanation, source: l.source,
      showOnPayslip: l.showOnPayslip,
    }));
  return { ...row, lines };
}

export interface MyPayslip {
  id: number;
  period: string;
  runType: RunType;
  netPay: Minor;
  grossEarnings: Minor;
  releasedAt: string;
}

/** An employee's released payslips, latest first. */
export function myPayslips(db: DbLike, employeeId: number): MyPayslip[] {
  return db
    .select({
      id: payslips.id, period: payrollRuns.period, runType: payrollRuns.type, netPay: payslips.netPay, grossEarnings: payslips.grossEarnings,
      releasedAt: payslips.releasedAt,
    })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .where(and(eq(payslips.employeeId, employeeId), isNotNull(payslips.releasedAt)))
    .orderBy(desc(payrollRuns.period), desc(payslips.id))
    .all()
    .map((p) => ({ ...p, releasedAt: p.releasedAt! }));
}

export interface YearStatement {
  fiscalYear: string;
  /** Periods with a released payslip, in order. */
  periods: string[];
  lines: { code: string; name: string; kind: ComponentKind; amounts: Minor[]; total: Minor }[];
  totals: { grossEarnings: Minor; totalDeductions: Minor; reimbursements: Minor; netPay: Minor };
}

/**
 * The fiscal-year statement of released payslips holding `period` (spec §5.6 "Payslips"), per component and month.
 * It is a statement, not a payslip.
 */
export function myYearStatement(db: DbLike, employeeId: number, period: string, fiscalYearStartMonth: number): YearStatement {
  const fy = fiscalYearOf(period, fiscalYearStartMonth);
  const slips = db
    .select({ payslip: payslips, period: payrollRuns.period })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .where(and(eq(payslips.employeeId, employeeId), isNotNull(payslips.releasedAt), gte(payrollRuns.period, fy.start), lte(payrollRuns.period, fy.end)))
    .orderBy(asc(payrollRuns.period))
    .all();
  const periods = [...new Set(slips.map((s) => s.period))];
  const periodOf = new Map(slips.map((s) => [s.payslip.id, s.period]));
  const lines = slips.length
    ? db.select().from(payslipLines).where(inArray(payslipLines.payslipId, slips.map((s) => s.payslip.id))).orderBy(asc(payslipLines.sortOrder)).all()
    : [];
  const byCode = new Map<string, YearStatement["lines"][number]>();
  for (const l of lines) {
    if (l.kind === "employer_contribution") continue;
    const line = byCode.get(l.componentCode) ?? { code: l.componentCode, name: l.componentName, kind: l.kind, amounts: periods.map(() => 0), total: 0 };
    if (l.source !== "component") line.name = db.select({ name: salaryComponents.name }).from(salaryComponents).where(eq(salaryComponents.code, l.componentCode)).get()?.name ?? line.name;
    line.amounts[periods.indexOf(periodOf.get(l.payslipId)!)]! += l.amount;
    line.total += l.amount;
    byCode.set(l.componentCode, line);
  }
  const kindOrder: ComponentKind[] = ["earning", "reimbursement", "deduction", "employer_contribution"];
  const sum = (pick: (p: PayslipRow) => Minor) => slips.reduce((s, x) => s + pick(x.payslip), 0);
  return {
    fiscalYear: fy.label,
    periods,
    lines: [...byCode.values()].sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind)),
    totals: {
      grossEarnings: sum((p) => p.grossEarnings), totalDeductions: sum((p) => p.totalDeductions), reimbursements: sum((p) => p.reimbursements),
      netPay: sum((p) => p.netPay),
    },
  };
}

export interface SalaryListItem {
  employeeId: number;
  code: string;
  name: string;
  status: string;
  dateOfJoining: ISODate;
  salaryId: number | null;
  effectiveFrom: ISODate | null;
  annualCtc: Minor | null;
  structureId: number | null;
  structure: string | null;
  overrides: Record<string, number | string>;
}

/** Current employees with the salary effective for `period` (null when none). */
export function listSalaries(db: DbLike, { period }: { period: string }): SalaryListItem[] {
  const people = db
    .select({ id: employees.id, code: employees.employeeCode, name: employees.displayName, status: employees.status, dateOfJoining: employees.dateOfJoining })
    .from(employees)
    .where(inArray(employees.status, ["active", "on_notice"]))
    .orderBy(asc(employees.employeeCode))
    .all();
  const salaries = db
    .select({ salary: employeeSalaries, structure: salaryStructures.name })
    .from(employeeSalaries)
    .innerJoin(salaryStructures, eq(salaryStructures.id, employeeSalaries.structureId))
    .where(lte(employeeSalaries.effectiveFrom, `${period}-01`))
    .orderBy(desc(employeeSalaries.effectiveFrom), desc(employeeSalaries.id))
    .all();
  return people.map((p) => {
    const current = salaries.find((s) => s.salary.employeeId === p.id);
    return {
      employeeId: p.id, code: p.code, name: p.name, status: p.status, dateOfJoining: p.dateOfJoining, salaryId: current?.salary.id ?? null,
      effectiveFrom: current?.salary.effectiveFrom ?? null, annualCtc: current?.salary.annualCtc ?? null,
      structureId: current?.salary.structureId ?? null, structure: current?.structure ?? null, overrides: current?.salary.overrides ?? {},
    };
  });
}

export interface StructureOption {
  id: number;
  name: string;
  components: CalcComponent[];
}

/** Active structures with their components, for the salary revision sheet's live breakdown. */
export function structureOptions(db: DbLike): StructureOption[] {
  return db
    .select()
    .from(salaryStructures)
    .where(eq(salaryStructures.archived, false))
    .orderBy(asc(salaryStructures.name))
    .all()
    .map((s) => ({ id: s.id, name: s.name, components: structureComponents(db, s.id) }));
}

export interface EmployeeSalaryView {
  current: {
    salaryId: number;
    effectiveFrom: ISODate;
    annualCtc: Minor;
    structureId: number;
    structure: string;
    overrides: Record<string, number | string>;
    lines: { code: string; name: string; kind: ComponentKind; monthly: Minor; annual: Minor }[];
    grossMonthly: Minor;
    netMonthly: Minor;
  } | null;
  history: {
    id: number;
    effectiveFrom: ISODate;
    annualCtc: Minor;
    structure: string;
    reason: string | null;
    createdByName: string | null;
    createdAt: string;
    /** A later row for the same month replaced it after payroll had used it. */
    corrected: boolean;
  }[];
}

/** An employee's salary for `period` with its full-month breakdown, and every revision (spec §5.6 "Salary assignment"). */
export function employeeSalaryView(db: DbLike, employeeId: number, period: string): EmployeeSalaryView {
  const history = db
    .select({ salary: employeeSalaries, structure: salaryStructures.name, createdByName: users.name })
    .from(employeeSalaries)
    .innerJoin(salaryStructures, eq(salaryStructures.id, employeeSalaries.structureId))
    .leftJoin(users, eq(users.id, employeeSalaries.createdBy))
    .where(eq(employeeSalaries.employeeId, employeeId))
    .orderBy(desc(employeeSalaries.effectiveFrom), desc(employeeSalaries.id))
    .all();
  const current = history.find((h) => h.salary.effectiveFrom <= `${period}-01`);
  let view: EmployeeSalaryView["current"] = null;
  if (current) {
    const preview = salaryPreview(db, { structureId: current.salary.structureId, annualCtc: current.salary.annualCtc, overrides: current.salary.overrides });
    view = {
      salaryId: current.salary.id, effectiveFrom: current.salary.effectiveFrom, annualCtc: current.salary.annualCtc,
      structureId: current.salary.structureId, structure: current.structure, overrides: current.salary.overrides,
      lines: preview.lines.map((l) => ({ ...l, kind: l.kind as ComponentKind })), grossMonthly: preview.grossMonthly, netMonthly: preview.netMonthly,
    };
  }
  return {
    current: view,
    history: history.map((h, i) => ({
      id: h.salary.id, effectiveFrom: h.salary.effectiveFrom, annualCtc: h.salary.annualCtc, structure: h.structure, reason: h.salary.reason,
      createdByName: h.createdByName, createdAt: h.salary.createdAt,
      corrected: history.slice(0, i).some((later) => later.salary.effectiveFrom === h.salary.effectiveFrom),
    })),
  };
}

export interface LoanListItem extends LoanRow {
  employeeName: string;
  employeeCode: string;
  repaid: Minor;
  outstanding: Minor;
}

export function listLoans(db: DbLike, { status }: { status?: LoanStatus }): LoanListItem[] {
  const rows = db
    .select({ loan: loans, employeeName: employees.displayName, employeeCode: employees.employeeCode })
    .from(loans)
    .innerJoin(employees, eq(employees.id, loans.employeeId))
    .where(status ? eq(loans.status, status) : undefined)
    .orderBy(desc(loans.id))
    .all();
  const repaid = new Map<number, Minor>();
  for (const r of db.select({ loanId: loanRepayments.loanId, amount: loanRepayments.amount }).from(loanRepayments).all()) {
    repaid.set(r.loanId, (repaid.get(r.loanId) ?? 0) + r.amount);
  }
  return rows.map(({ loan, employeeName, employeeCode }) => {
    const paid = repaid.get(loan.id) ?? 0;
    return { ...loan, employeeName, employeeCode, repaid: paid, outstanding: Math.max(0, loan.principal - paid) };
  });
}

export interface ClaimListItem extends ExpenseClaimRow {
  employeeName: string;
  employeeCode: string;
}

function claimsWhere(db: DbLike, where: SQL): ClaimListItem[] {
  return db
    .select({ claim: expenseClaims, employeeName: employees.displayName, employeeCode: employees.employeeCode })
    .from(expenseClaims)
    .innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
    .where(where)
    .orderBy(desc(expenseClaims.claimDate), desc(expenseClaims.id))
    .all()
    .map(({ claim, employeeName, employeeCode }) => ({ ...claim, employeeName, employeeCode }));
}

/** Every claim except drafts, for `claim.view.all`. */
export function listClaims(db: DbLike, { status }: { status?: ClaimStatus }): ClaimListItem[] {
  return claimsWhere(db, status ? eq(expenseClaims.status, status) : ne(expenseClaims.status, "draft"));
}

export function myClaims(db: DbLike, employeeId: number): ClaimListItem[] {
  return claimsWhere(db, eq(expenseClaims.employeeId, employeeId));
}

/** Submitted claims the user may decide: their reports' (or everyone's for org-wide approvers), never their own. */
export function pendingClaimsFor(db: DbLike, user: ScopeUser): ClaimListItem[] {
  if (!can(user, "claim.approve")) return [];
  return claimsWhere(db, eq(expenseClaims.status, "submitted"))
    .filter((c) => canDecideClaim(db, user, c.employeeId))
    .sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
}

export interface VerificationLogItem {
  id: number;
  at: string;
  ip: string | null;
  amountChecked: boolean;
  matched: boolean | null;
  code: string;
  period: string;
  employeeName: string;
}

/** Recent public verification lookups, for payroll admins. */
export function verificationLog(db: DbLike, { limit = 100 }: { limit?: number } = {}): VerificationLogItem[] {
  return db
    .select({ v: payslipVerifications, code: payslips.verificationCode, snapshot: payslips.snapshot, period: payrollRuns.period })
    .from(payslipVerifications)
    .innerJoin(payslips, eq(payslips.id, payslipVerifications.payslipId))
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .orderBy(desc(payslipVerifications.at), desc(payslipVerifications.id))
    .limit(limit)
    .all()
    .map(({ v, code, snapshot, period }) => ({
      id: v.id, at: v.at, ip: v.ip, amountChecked: v.amountChecked, matched: v.matched, code: code ?? "", period, employeeName: snapshot.name,
    }));
}

