import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { payslips, payslipVerifications, salaryStructures } from "@/server/db/schema";
import { createRateLimiter } from "@/server/lib/rate-limit";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { computeRun, createRun } from "@/server/modules/payroll/runs";
import { reviseSalary } from "@/server/modules/payroll/salaries";
import { seedPayrollDefaults } from "@/server/modules/payroll/structures";
import { lookupPayslip, maskName } from "@/server/modules/payroll/verify";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser } from "../helpers/fixtures";

const NOV = { today: "2026-12-02", now: new Date("2026-12-02T06:00:00Z") };
const CODE = "K7QX2M9PWD4R";
const request = { ip: "203.0.113.9", userAgent: "Mozilla/5.0" };
let db: DB;
let payslipId: number;
const fresh = () => ({ limiter: createRateLimiter({ windowMs: 60_000, max: 100 }) });

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db, { attendanceMode: "auto" });
  seedDefaultLeaveTypes(db);
  seedPayrollDefaults(db);
  const hrId = insertUser(db, { roles: ["payroll_admin"] }).id;
  const yash = insertEmployee(db, { firstName: "Yash", lastName: "Sharma", dateOfJoining: "2024-03-15" });
  reviseSalary(db, hrId, {
    employeeId: yash.id, effectiveFrom: "2026-01-01", annualCtc: 120_000_000, structureId: db.select().from(salaryStructures).get()!.id,
    overrides: {}, reason: null,
  });
  const run = createRun(db, hrId, { period: "2026-11", type: "regular", notes: null }, NOV);
  computeRun(db, hrId, run.id, NOV);
  payslipId = db.select().from(payslips).get()!.id;
  // Released late on 1 Dec UTC, which is already 2 Dec in India.
  db.update(payslips).set({ verificationCode: CODE, releasedAt: "2026-12-01T20:00:00.000Z" }).where(eq(payslips.id, payslipId)).run();
});

describe("payslip verification", () => {
  it("masks names", () => {
    expect(maskName("Yash Sharma")).toBe("Y*** S***");
    expect(maskName("  asha  ")).toBe("A***");
    expect(maskName("Ravi Kumar Rao")).toBe("R*** K*** R***");
  });

  it("finds a released payslip by its code without showing the net pay, and logs each lookup", () => {
    expect(lookupPayslip(db, "NOPE", { ...request, netPay: null }, fresh())).toBeNull();
    expect(lookupPayslip(db, "ABCDEFGHJKLM", { ...request, netPay: null }, fresh())).toBeNull();
    expect(db.select().from(payslipVerifications).all()).toEqual([]);

    const found = lookupPayslip(db, "k7qx-2m9p-wd4r", { ...request, netPay: null }, fresh());
    expect(found).toEqual({ company: "PVCON Consulting", maskedName: "Y*** S***", period: "November 2026", issuedOn: "2026-12-02", matched: null });
    expect(lookupPayslip(db, CODE, { ...request, netPay: 10_000_000 }, fresh())!.matched).toBe(true);
    expect(lookupPayslip(db, CODE, { ...request, netPay: 9_999_900 }, fresh())!.matched).toBe(false);
    expect(db.select().from(payslipVerifications).all().map((v) => [v.payslipId, v.ip, v.amountChecked, v.matched])).toEqual([
      [payslipId, "203.0.113.9", false, null], [payslipId, "203.0.113.9", true, true], [payslipId, "203.0.113.9", true, false],
    ]);
  });

  it("ignores unreleased payslips and limits lookups per address", () => {
    db.update(payslips).set({ releasedAt: null }).run();
    expect(lookupPayslip(db, CODE, { ...request, netPay: null }, fresh())).toBeNull();
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    lookupPayslip(db, CODE, { ...request, netPay: null }, { limiter });
    lookupPayslip(db, CODE, { ...request, netPay: null }, { limiter });
    expectDomainError(() => lookupPayslip(db, CODE, { ...request, netPay: null }, { limiter }), "RATE_LIMITED");
    expect(lookupPayslip(db, CODE, { ...request, ip: "198.51.100.1", netPay: null }, { limiter })).toBeNull();
  });
});
