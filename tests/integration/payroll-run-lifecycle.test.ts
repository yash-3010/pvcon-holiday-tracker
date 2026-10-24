import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import {
  attendanceDays, compOffClaims, employeeSalaries, expenseClaims, loanRepayments, loans, notifications, payslips, payrollRuns,
  salaryStructures, type EmployeeRow,
} from "@/server/db/schema";
import { setOverride } from "@/server/modules/attendance/overrides";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import {
  approveRun, cancelRun, computeRun, createRun, markPaid, releasePayslip, releaseRun, requireRun, revertRun, setPayslipStatus,
} from "@/server/modules/payroll/runs";
import { reviseSalary } from "@/server/modules/payroll/salaries";
import { seedPayrollDefaults } from "@/server/modules/payroll/structures";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser } from "../helpers/fixtures";

let db: DB;
let makerId: number;
let checkerId: number;
let ashaUserId: number;
let asha: EmployeeRow;
let kiran: EmployeeRow;
/** The day after the period ends. */
const after = (period: string) => {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { today: `${next}-02`, now: new Date(`${next}-02T06:00:00Z`) };
};
const NOV = after("2026-11");
const computed = (period: string) => {
  const run = createRun(db, makerId, { period, type: "regular", notes: null }, after(period));
  computeRun(db, makerId, run.id, after(period));
  return requireRun(db, run.id);
};
const approved = (period: string) => approveRun(db, checkerId, computed(period).id, after(period));
const slipOf = (runId: number, employeeId: number) =>
  db.select().from(payslips).where(and(eq(payslips.runId, runId), eq(payslips.employeeId, employeeId))).get()!;
const lockedDays = (employeeId: number) =>
  db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.locked, true))).all().length;

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db, { attendanceMode: "auto" });
  seedDefaultLeaveTypes(db);
  seedPayrollDefaults(db);
  makerId = insertUser(db, { roles: ["payroll_admin"] }).id;
  checkerId = insertUser(db, { roles: ["super_admin"] }).id;
  ashaUserId = insertUser(db).id;
  asha = insertEmployee(db, { firstName: "Asha", dateOfJoining: "2024-03-15", userId: ashaUserId });
  kiran = insertEmployee(db, { firstName: "Kiran", dateOfJoining: "2025-06-01" });
  const structureId = db.select().from(salaryStructures).get()!.id;
  for (const e of [asha, kiran]) {
    reviseSalary(db, makerId, { employeeId: e.id, effectiveFrom: "2026-01-01", annualCtc: 120_000_000, structureId, overrides: {}, reason: null });
  }
});

describe("approval", () => {
  it("needs someone other than the maker, a computed run and no errors", () => {
    const draft = createRun(db, makerId, { period: "2026-11", type: "regular", notes: null }, NOV);
    expectDomainError(() => approveRun(db, checkerId, draft.id, NOV), "NOT_COMPUTED");
    computeRun(db, makerId, draft.id, NOV);
    expectDomainError(() => approveRun(db, makerId, draft.id, NOV), "SAME_PERSON");

    db.update(employeeSalaries).set({ overrides: { HRA: "BASIC / (PAID_DAYS - 30)" } }).where(eq(employeeSalaries.employeeId, kiran.id)).run();
    computeRun(db, makerId, draft.id, NOV);
    expectDomainError(() => approveRun(db, checkerId, draft.id, NOV), "PAYSLIP_ERRORS");
  });

  it("locks the period's attendance of paid employees", () => {
    const run = computed("2026-11");
    setPayslipStatus(db, run.id, kiran.id, "excluded");
    const result = approveRun(db, checkerId, run.id, NOV);
    expect(result).toMatchObject({ status: "approved", approvedBy: checkerId, approvedAt: NOV.now.toISOString() });
    expect(lockedDays(asha.id)).toBe(30);
    expect(lockedDays(kiran.id)).toBe(0);
    expectDomainError(
      () => setOverride(db, makerId, { employeeId: asha.id, date: "2026-11-10", status: "absent", note: "Late entry" }, NOV),
      "DAY_LOCKED",
    );
  });
});

describe("what approval pays", () => {
  it("marks claims and comp-off payouts paid and repays a loan until it closes", () => {
    const claim = db.insert(expenseClaims).values({
      employeeId: asha.id, category: "travel", claimDate: "2026-11-02", amount: 120_000, description: "Cab", status: "approved",
    }).returning().get();
    db.insert(compOffClaims).values({
      employeeId: asha.id, workedDate: "2026-11-07", workedMinutes: 480, daysRequested: 1, status: "approved", resolution: "payout",
      decidedAt: "2026-11-09T05:00:00.000Z",
    }).run();
    const loan = db.insert(loans).values({ employeeId: kiran.id, principal: 1_000_000, emi: 400_000, startPeriod: "2026-11" }).returning().get();

    const nov = approved("2026-11");
    expect(db.select().from(expenseClaims).get()).toMatchObject({ id: claim.id, status: "paid", paidRunId: nov.id, financeBy: checkerId });
    expect(db.select().from(compOffClaims).get()!.paidRunId).toBe(nov.id);
    expect(slipOf(nov.id, asha.id).variables.COMP_OFF_DAYS).toBe(1);

    const dec = approved("2026-12");
    expect(slipOf(dec.id, asha.id).variables.COMP_OFF_DAYS).toBe(0);
    approved("2027-01");
    expect(db.select().from(loanRepayments).all().map((r) => [r.period, r.amount])).toEqual([
      ["2026-11", 400_000], ["2026-12", 400_000], ["2027-01", 200_000],
    ]);
    expect(db.select().from(loans).where(eq(loans.id, loan.id)).get()!.status).toBe("closed");
  });
});

describe("revert", () => {
  it("undoes an approval exactly", () => {
    db.insert(expenseClaims).values({
      employeeId: asha.id, category: "travel", claimDate: "2026-11-02", amount: 120_000, description: "Cab", status: "approved",
    }).run();
    db.insert(compOffClaims).values({
      employeeId: asha.id, workedDate: "2026-11-07", workedMinutes: 480, daysRequested: 1, status: "approved", resolution: "payout",
      decidedAt: "2026-11-09T05:00:00.000Z",
    }).run();
    const loan = db.insert(loans).values({ employeeId: kiran.id, principal: 400_000, emi: 400_000, startPeriod: "2026-11" }).returning().get();
    const nov = approved("2026-11");
    expect(db.select().from(loans).get()!.status).toBe("closed");

    expect(revertRun(db, nov.id)).toMatchObject({ status: "computed", approvedBy: null, approvedAt: null });
    expect(db.select().from(expenseClaims).get()).toMatchObject({ status: "approved", paidRunId: null, financeBy: null });
    expect(db.select().from(compOffClaims).get()!.paidRunId).toBeNull();
    expect(db.select().from(loanRepayments).all()).toEqual([]);
    expect(db.select().from(loans).where(eq(loans.id, loan.id)).get()!.status).toBe("active");
    expect(lockedDays(asha.id)).toBe(0);
    expectDomainError(() => revertRun(db, nov.id), "NOT_APPROVED");
  });

  it("refuses once a later run exists or the run is released", () => {
    const nov = approved("2026-11");
    const dec = createRun(db, makerId, { period: "2026-12", type: "regular", notes: null }, after("2026-12"));
    expectDomainError(() => revertRun(db, nov.id), "LATER_RUN");
    cancelRun(db, dec.id);
    releaseRun(db, nov.id, NOV);
    expectDomainError(() => revertRun(db, nov.id), "RUN_LOCKED");
    expectDomainError(() => computeRun(db, makerId, nov.id, NOV), "RUN_LOCKED");
  });
});

describe("release, payment and cancellation", () => {
  it("releases included payslips, then held ones one by one, and records payment", () => {
    const run = computed("2026-11");
    setPayslipStatus(db, run.id, kiran.id, "hold");
    approveRun(db, checkerId, run.id, NOV);
    expectDomainError(() => markPaid(db, run.id, { paidOn: "2026-12-01", reference: "NEFT" }, NOV), "NOT_RELEASED");

    const released = releaseRun(db, run.id, NOV);
    expect(released.run).toMatchObject({ status: "released", releasedAt: NOV.now.toISOString() });
    expect(released.payslipIds).toEqual([slipOf(run.id, asha.id).id]);
    expect(slipOf(run.id, asha.id).releasedAt).toBe(NOV.now.toISOString());
    expect(slipOf(run.id, kiran.id).releasedAt).toBeNull();
    expect(db.select().from(notifications).where(eq(notifications.userId, ashaUserId)).all().map((n) => [n.type, n.title, n.link])).toEqual([
      ["payslip.released", "Your payslip for November 2026 is ready", `/me/payslips/${slipOf(run.id, asha.id).id}`],
    ]);

    expectDomainError(() => releasePayslip(db, slipOf(run.id, asha.id).id, NOV), "NOT_HELD");
    expect(releasePayslip(db, slipOf(run.id, kiran.id).id, NOV)).toMatchObject({ status: "ok", releasedAt: NOV.now.toISOString() });

    expect(markPaid(db, run.id, { paidOn: "2026-12-01", reference: "NEFT 123" }, NOV)).toMatchObject({
      status: "paid", paidOn: "2026-12-01", paymentRef: "NEFT 123", paidAt: NOV.now.toISOString(),
    });
  });

  it("cancels only runs not yet approved", () => {
    const run = computed("2026-11");
    expect(cancelRun(db, run.id).status).toBe("cancelled");
    expect(db.select().from(payslips).all()).toEqual([]);
    const again = approved("2026-11");
    expectDomainError(() => cancelRun(db, again.id), "RUN_LOCKED");
    expect(db.select().from(payrollRuns).all().map((r) => r.status)).toEqual(["cancelled", "approved"]);
  });
});
