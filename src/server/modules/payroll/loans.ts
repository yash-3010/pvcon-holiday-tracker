import { and, asc, eq, inArray } from "drizzle-orm";
import type { Minor } from "@/lib/money";
import type { LoanStatus } from "@/lib/payroll/constants";
import type { LoanInput } from "@/lib/validation/payroll";
import type { DbLike } from "@/server/db/client";
import { loanRepayments, loans, payrollInputs, payrollRuns, type LoanRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { requireEmployee } from "@/server/modules/employees/service";
import { loanOutstanding } from "./inputs";

export function requireLoan(db: DbLike, id: number): LoanRow {
  const row = db.select().from(loans).where(eq(loans.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Loan not found.");
  return row;
}

/** A loan or salary advance (spec §5.6 "Loans & claims"): its EMI is deducted each regular run from `startPeriod`. */
export function createLoan(db: DbLike, actorUserId: number, input: LoanInput): LoanRow {
  const employee = requireEmployee(db, input.employeeId);
  if (employee.status === "exited") throw new DomainError("NOT_CURRENT", "This employee has left.", { employeeId: ["Has left"] });
  return db.insert(loans).values({ ...input, createdBy: actorUserId }).returning().get();
}

/**
 * Pauses, resumes or closes a loan; closing early writes off the rest. A repaid loan stays closed. Computed runs that
 * deduct the loan go back to draft so they are computed again.
 */
export function setLoanStatus(db: DbLike, loanId: number, status: LoanStatus): { before: LoanRow; after: LoanRow } {
  const before = requireLoan(db, loanId);
  if (status !== "closed" && loanOutstanding(db, before.id, before.principal) === 0) {
    throw new DomainError("REPAID", "This loan is repaid.");
  }
  const after = db.update(loans).set({ status }).where(eq(loans.id, loanId)).returning().get()!;
  const runIds = db
    .select({ runId: payrollInputs.runId })
    .from(payrollInputs)
    .where(and(eq(payrollInputs.source, "loan"), eq(payrollInputs.sourceId, loanId)))
    .all()
    .map((r) => r.runId);
  if (runIds.length) {
    db.update(payrollRuns).set({ status: "draft" }).where(and(inArray(payrollRuns.id, runIds), eq(payrollRuns.status, "computed"))).run();
  }
  return { before, after };
}

export interface LoanStatement {
  loan: LoanRow;
  repayments: { period: string; amount: Minor; runId: number }[];
  repaid: Minor;
  outstanding: Minor;
}

export function loanStatement(db: DbLike, loanId: number): LoanStatement {
  const loan = requireLoan(db, loanId);
  const repayments = db
    .select({ period: loanRepayments.period, amount: loanRepayments.amount, runId: loanRepayments.runId })
    .from(loanRepayments)
    .where(eq(loanRepayments.loanId, loanId))
    .orderBy(asc(loanRepayments.period), asc(loanRepayments.id))
    .all();
  const repaid = repayments.reduce((s, r) => s + r.amount, 0);
  return { loan, repayments, repaid, outstanding: Math.max(0, loan.principal - repaid) };
}
