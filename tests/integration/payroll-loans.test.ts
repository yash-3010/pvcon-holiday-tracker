import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { loanRepayments, payrollInputs, payrollRuns, salaryStructures, type EmployeeRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { refreshSystemInputs } from "@/server/modules/payroll/inputs";
import { createLoan, loanStatement, setLoanStatus } from "@/server/modules/payroll/loans";
import { computeRun, createRun, requireRun } from "@/server/modules/payroll/runs";
import { reviseSalary } from "@/server/modules/payroll/salaries";
import { seedPayrollDefaults } from "@/server/modules/payroll/structures";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser } from "../helpers/fixtures";

let db: DB;
let hrId: number;
let kiran: EmployeeRow;
const NOV = { today: "2026-12-02", now: new Date("2026-12-02T06:00:00Z") };
const loanInput = { type: "loan" as const, principal: 1_000_000, emi: 400_000, startPeriod: "2026-09", note: null };
const emiInputs = (runId: number) =>
  db.select().from(payrollInputs).where(eq(payrollInputs.runId, runId)).all().filter((i) => i.source === "loan").map((i) => i.amount);

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db, { attendanceMode: "auto" });
  seedDefaultLeaveTypes(db);
  seedPayrollDefaults(db);
  hrId = insertUser(db, { roles: ["payroll_admin"] }).id;
  kiran = insertEmployee(db, { firstName: "Kiran", dateOfJoining: "2025-06-01" });
  reviseSalary(db, hrId, {
    employeeId: kiran.id, effectiveFrom: "2026-01-01", annualCtc: 120_000_000, structureId: db.select().from(salaryStructures).get()!.id,
    overrides: {}, reason: null,
  });
});

describe("loans", () => {
  it("are given to current employees only", () => {
    expect(createLoan(db, hrId, { employeeId: kiran.id, ...loanInput })).toMatchObject({ status: "active", principal: 1_000_000, createdBy: hrId });
    const gone = insertEmployee(db, { status: "exited", lastWorkingDate: "2026-10-31" });
    expectDomainError(() => createLoan(db, hrId, { employeeId: gone.id, ...loanInput }), "NOT_CURRENT");
  });

  it("deduct the EMI capped at the outstanding, skip paused loans and show a statement", () => {
    const loan = createLoan(db, hrId, { employeeId: kiran.id, ...loanInput });
    const oct = db.insert(payrollRuns).values({ period: "2026-10", status: "approved" }).returning().get();
    db.insert(loanRepayments).values([
      { loanId: loan.id, runId: oct.id, period: "2026-09", amount: 400_000 },
      { loanId: loan.id, runId: oct.id, period: "2026-10", amount: 400_000 },
    ]).run();
    const nov = createRun(db, hrId, { period: "2026-11", type: "regular", notes: null }, NOV);
    refreshSystemInputs(db, nov);
    expect(emiInputs(nov.id)).toEqual([200_000]);

    setLoanStatus(db, loan.id, "paused");
    refreshSystemInputs(db, nov);
    expect(emiInputs(nov.id)).toEqual([]);

    expect(loanStatement(db, loan.id)).toMatchObject({
      repaid: 800_000, outstanding: 200_000,
      repayments: [{ period: "2026-09", amount: 400_000 }, { period: "2026-10", amount: 400_000 }],
    });
  });

  it("send a computed run back to draft when a loan in it changes, and can't reopen once repaid", () => {
    const loan = createLoan(db, hrId, { employeeId: kiran.id, ...loanInput, principal: 400_000 });
    const nov = createRun(db, hrId, { period: "2026-11", type: "regular", notes: null }, NOV);
    computeRun(db, hrId, nov.id, NOV);
    expect(emiInputs(nov.id)).toEqual([400_000]);
    setLoanStatus(db, loan.id, "paused");
    expect(requireRun(db, nov.id).status).toBe("draft");

    db.insert(loanRepayments).values({ loanId: loan.id, runId: nov.id, period: "2026-11", amount: 400_000 }).run();
    setLoanStatus(db, loan.id, "closed");
    expectDomainError(() => setLoanStatus(db, loan.id, "active"), "REPAID");
  });
});
