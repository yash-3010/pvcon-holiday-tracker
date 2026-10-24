import { and, eq, inArray, isNull, lte, ne } from "drizzle-orm";
import Papa from "papaparse";
import { formatDate, monthRange } from "@/lib/dates";
import { toMinor, type Minor } from "@/lib/money";
import { CLAIM_CATEGORY_LABELS, SYSTEM_COMPONENTS } from "@/lib/payroll/constants";
import type { DbLike } from "@/server/db/client";
import {
  employees, expenseClaims, loanRepayments, loans, payrollInputs, payrollRuns, type PayrollInputRow, type PayrollRunRow,
  type SalaryComponentRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { employedDuring } from "@/server/modules/attendance/compute";
import { requireEmployee } from "@/server/modules/employees/service";
import { arrearsFor } from "./arrears";
import { componentByCode, requireComponent } from "./components";

export const EDITABLE_RUN_STATUSES = ["draft", "computed"] as const;
const MAX_IMPORT_ROWS = 1000;

export function requireRun(db: DbLike, id: number): PayrollRunRow {
  const row = db.select().from(payrollRuns).where(eq(payrollRuns.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Payroll run not found.");
  return row;
}

export function assertEditable(run: PayrollRunRow): void {
  if (!(EDITABLE_RUN_STATUSES as readonly string[]).includes(run.status)) {
    throw new DomainError("RUN_LOCKED", `This run is ${run.status}; it can't be changed.`);
  }
}

/** Employee ids on some day of the run's period. */
export function employedInPeriod(db: DbLike, period: string): Set<number> {
  const { start, end } = monthRange(period);
  return new Set(db.select({ id: employees.id }).from(employees).where(employedDuring(start, end)).all().map((e) => e.id));
}

/** A computed run whose inputs change goes back to draft, so it must be computed again before approval. */
function inputsChanged(db: DbLike, run: PayrollRunRow): void {
  if (run.status === "computed") db.update(payrollRuns).set({ status: "draft" }).where(eq(payrollRuns.id, run.id)).run();
}

function assertManualComponent(component: SalaryComponentRow): SalaryComponentRow {
  if (component.calc !== "input" || component.system || component.archived) {
    throw new DomainError("NOT_INPUT", `${component.code} is not entered per run.`, { componentId: ["Not entered per run"] });
  }
  return component;
}

export interface ManualInput {
  runId: number;
  employeeId: number;
  componentId: number;
  amount: Minor;
  note: string | null;
}

/** A one-time amount for an employee, to a component entered per run (spec §5.6 run step 2). */
export function addManualInput(db: DbLike, actorUserId: number, input: ManualInput): PayrollInputRow {
  const run = requireRun(db, input.runId);
  assertEditable(run);
  const component = assertManualComponent(requireComponent(db, input.componentId));
  const employee = requireEmployee(db, input.employeeId);
  if (run.type === "regular" && !employedInPeriod(db, run.period).has(employee.id)) {
    throw new DomainError("NOT_EMPLOYED", `${employee.displayName} isn't employed in this period.`, { employeeId: ["Not employed in the period"] });
  }
  const row = db
    .insert(payrollInputs)
    .values({ ...input, label: component.name, source: "manual", createdBy: actorUserId })
    .returning()
    .get();
  inputsChanged(db, run);
  return row;
}

export function deleteInput(db: DbLike, inputId: number): PayrollInputRow {
  const input = db.select().from(payrollInputs).where(eq(payrollInputs.id, inputId)).get();
  if (!input) throw new DomainError("NOT_FOUND", "Input not found.");
  if (input.source !== "manual") throw new DomainError("NOT_MANUAL", "Only inputs entered by hand can be deleted.");
  const run = requireRun(db, input.runId);
  assertEditable(run);
  db.delete(payrollInputs).where(eq(payrollInputs.id, inputId)).run();
  inputsChanged(db, run);
  return input;
}

/**
 * Imports manual inputs from a CSV with the columns `employee_code, component_code, amount, note` (amount in rupees).
 * Nothing is added unless every row is valid.
 */
export function importInputs(db: DbLike, actorUserId: number, runId: number, csv: string): { added: number; errors: string[] } {
  const run = requireRun(db, runId);
  assertEditable(run);
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase(),
  });
  const headers = parsed.meta.fields ?? [];
  const missing = ["employee_code", "component_code", "amount"].filter((h) => !headers.includes(h));
  if (missing.length) return { added: 0, errors: [`Missing column(s): ${missing.join(", ")}`] };
  if (parsed.data.length === 0) return { added: 0, errors: ["The file has no rows"] };
  if (parsed.data.length > MAX_IMPORT_ROWS) return { added: 0, errors: [`Import at most ${MAX_IMPORT_ROWS} rows at a time`] };

  const byCode = new Map(db.select().from(employees).all().map((e) => [e.employeeCode.toUpperCase(), e]));
  const employed = run.type === "regular" ? employedInPeriod(db, run.period) : null;
  const errors: string[] = [];
  const rows: (ManualInput & { label: string })[] = [];
  parsed.data.forEach((raw, index) => {
    const row = index + 1;
    const code = (raw.employee_code ?? "").trim();
    const componentCode = (raw.component_code ?? "").trim().toUpperCase();
    const amount = Number((raw.amount ?? "").trim().replace(/,/g, ""));
    const note = (raw.note ?? "").trim().slice(0, 200) || null;
    const employee = byCode.get(code.toUpperCase());
    if (!employee) return void errors.push(`Row ${row}: no employee ${code || "(blank)"}`);
    if (employed && !employed.has(employee.id)) return void errors.push(`Row ${row}: ${employee.displayName} isn't employed in this period`);
    const component = componentByCode(db, componentCode);
    if (!component) return void errors.push(`Row ${row}: no component ${componentCode || "(blank)"}`);
    if (component.calc !== "input" || component.system || component.archived) return void errors.push(`Row ${row}: ${component.code} is not entered per run`);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) return void errors.push(`Row ${row}: enter an amount above zero`);
    rows.push({ runId, employeeId: employee.id, componentId: component.id, amount: toMinor(amount), note, label: component.name });
  });
  if (errors.length) return { added: 0, errors };
  for (const r of rows) db.insert(payrollInputs).values({ ...r, source: "manual", createdBy: actorUserId }).run();
  inputsChanged(db, run);
  return { added: rows.length, errors: [] };
}

/** Outstanding on a loan: the principal less repayments, leaving out those of `exceptRunId`. */
export function loanOutstanding(db: DbLike, loanId: number, principal: Minor, exceptRunId?: number): Minor {
  const paid = db
    .select({ amount: loanRepayments.amount, runId: loanRepayments.runId })
    .from(loanRepayments)
    .where(eq(loanRepayments.loanId, loanId))
    .all()
    .filter((r) => r.runId !== exceptRunId)
    .reduce((s, r) => s + r.amount, 0);
  return Math.max(0, principal - paid);
}

/**
 * Replaces a regular run's system inputs (spec §5.6 run step 2): approved, unpaid expense claims dated by the period
 * end → REIMB; EMIs of active loans started by the period, capped at the outstanding → LOAN_EMI; arrears of back-dated
 * revisions. Comp-off payouts and exit encashment come through the COMP_OFF_DAYS and ENCASH_DAYS variables. Off-cycle
 * runs take manual inputs only. Returns warnings for the run.
 */
export function refreshSystemInputs(db: DbLike, run: PayrollRunRow): string[] {
  db.delete(payrollInputs).where(and(eq(payrollInputs.runId, run.id), ne(payrollInputs.source, "manual"))).run();
  if (run.type !== "regular") return [];
  const employed = [...employedInPeriod(db, run.period)];
  if (!employed.length) return [];
  const { end } = monthRange(run.period);

  const reimb = componentByCode(db, SYSTEM_COMPONENTS.reimbursement)!;
  const claims = db
    .select()
    .from(expenseClaims)
    .where(and(inArray(expenseClaims.employeeId, employed), eq(expenseClaims.status, "approved"), isNull(expenseClaims.paidRunId), lte(expenseClaims.claimDate, end)))
    .orderBy(expenseClaims.claimDate, expenseClaims.id)
    .all();
  for (const c of claims) {
    db.insert(payrollInputs).values({
      runId: run.id, employeeId: c.employeeId, componentId: reimb.id, amount: c.amount, source: "claim", sourceId: c.id,
      label: `Claim: ${CLAIM_CATEGORY_LABELS[c.category]} on ${formatDate(c.claimDate)}`,
    }).run();
  }

  const emi = componentByCode(db, SYSTEM_COMPONENTS.loan)!;
  const active = db
    .select()
    .from(loans)
    .where(and(inArray(loans.employeeId, employed), eq(loans.status, "active"), lte(loans.startPeriod, run.period)))
    .orderBy(loans.id)
    .all();
  for (const loan of active) {
    const amount = Math.min(loan.emi, loanOutstanding(db, loan.id, loan.principal, run.id));
    if (amount <= 0) continue;
    db.insert(payrollInputs).values({
      runId: run.id, employeeId: loan.employeeId, componentId: emi.id, amount, source: "loan", sourceId: loan.id,
      label: loan.type === "advance" ? "Advance recovery" : "Loan repayment",
    }).run();
  }

  const arrears = arrearsFor(db, run, employed);
  for (const a of arrears.inputs) db.insert(payrollInputs).values({ runId: run.id, ...a, source: "arrear" }).run();
  return arrears.warnings;
}
