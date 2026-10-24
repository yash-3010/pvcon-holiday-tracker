import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { expenseClaims, payslips, salaryStructures, type EmployeeRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { updateEmployeeBank } from "@/server/modules/employees/service";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { componentByCode } from "@/server/modules/payroll/components";
import { addManualInput } from "@/server/modules/payroll/inputs";
import { createLoan } from "@/server/modules/payroll/loans";
import { approveRun, computeRun, createRun } from "@/server/modules/payroll/runs";
import { reviseSalary } from "@/server/modules/payroll/salaries";
import { seedPayrollDefaults } from "@/server/modules/payroll/structures";
import { runReport } from "@/server/modules/reports/registry";
import { createTestDb } from "../helpers/db";
import { insertDepartment, insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const NOW = new Date("2026-12-02T06:00:00Z");
const NOV = { today: "2026-12-02", now: NOW };
let db: DB;
let maker: SessionUser, checker: SessionUser, hr: SessionUser;
let asha: EmployeeRow, kiran: EmployeeRow;
let runId: number;

const run = (user: SessionUser, slug: string, raw: Record<string, string> = {}) => runReport(db, user, slug, raw, NOW).result;
const approve = () => approveRun(db, checker.id, runId, { now: NOW });
const slip = (e: EmployeeRow) => db.select().from(payslips).where(eq(payslips.employeeId, e.id)).get()!;

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db, { attendanceMode: "auto" });
  seedDefaultLeaveTypes(db);
  seedPayrollDefaults(db);
  maker = sessionUserFor(db, insertUser(db, { roles: ["payroll_admin"], name: "Maker" }));
  checker = sessionUserFor(db, insertUser(db, { roles: ["payroll_admin"], name: "Checker" }));
  hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
  const eng = insertDepartment(db, "Engineering").id;
  const sales = insertDepartment(db, "Sales").id;
  asha = insertEmployee(db, { firstName: "Asha", employeeCode: "PV001", departmentId: eng, dateOfJoining: "2024-03-15" });
  kiran = insertEmployee(db, { firstName: "Kiran", employeeCode: "PV002", departmentId: sales, dateOfJoining: "2024-03-15" });
  const structureId = db.select().from(salaryStructures).get()!.id;
  for (const e of [asha, kiran]) reviseSalary(db, maker.id, { employeeId: e.id, effectiveFrom: "2026-01-01", annualCtc: 120_000_000, structureId, overrides: {}, reason: null });
  reviseSalary(db, maker.id, { employeeId: asha.id, effectiveFrom: "2026-10-01", annualCtc: 150_000_000, structureId, overrides: {}, reason: "Promotion" });
  updateEmployeeBank(db, asha.id, { bankName: "HDFC Bank", bankAccount: "50100012345678", bankIfsc: "HDFC0001234", pan: null, aadhaar: null, passport: null });
  runId = createRun(db, maker.id, { period: "2026-11", type: "regular", notes: null }, NOV).id;
  addManualInput(db, maker.id, { runId, employeeId: asha.id, componentId: componentByCode(db, "BONUS")!.id, amount: 500_050, note: null });
  computeRun(db, maker.id, runId, NOV);
});

describe("payroll reports", () => {
  it("are for payroll only", () => {
    expectDomainError(() => run(hr, "payroll-register"), "FORBIDDEN");
  });

  it("show the register of the latest computed run with a column per component", () => {
    const result = run(maker, "payroll-register");
    expect(result.note).toMatch(/^November 2026 regular run \(computed\)/);
    expect(result.columns.map((c) => c.key)).toContain("c:BONUS");
    expect(result.rows.map((r) => [r.code, r.department, r.status])).toEqual([["PV001", "Engineering", "Included"], ["PV002", "Sales", "Included"]]);
    expect(result.rows[0]).toMatchObject({ "c:BONUS": 500_050, net: slip(asha).netPay, gross: slip(asha).grossEarnings });
    expect(result.rows[1]).toMatchObject({ "c:BONUS": 0, net: slip(kiran).netPay });
  });

  it("sum components per month of the financial year from approved runs only", () => {
    expect(run(maker, "component-summary", { fy: "2026" }).rows).toEqual([]);
    approve();
    const result = run(maker, "component-summary", { fy: "2026" });
    expect(result.columns.slice(2, 4).map((c) => c.key)).toEqual(["2026-04", "2026-05"]);
    expect(result.rows[0]!.kind).toBe("Earning");
    expect(result.rows.find((r) => r.component === "Bonus")).toMatchObject({ "2026-11": 500_050, "2026-04": 0, total: 500_050 });
    const earnings = result.rows.filter((r) => r.kind === "Earning").reduce((s, r) => s + (r.total as number), 0);
    expect(earnings).toBe(slip(asha).grossEarnings + slip(kiran).grossEarnings);
    expect(result.note).toMatch(/^FY 2026–27/);
  });

  it("give the bank advice of an approved run, with full account numbers in the (audited) export only", () => {
    expect(run(maker, "bank-advice").note).toMatch(/No approved/);
    approve();
    expect(runReport(db, maker, "bank-advice", { run: String(runId) }, NOW, { forExport: true }).result.rows).toEqual([
      { code: "PV001", name: "Asha Test", bankName: "HDFC Bank", account: "50100012345678", ifsc: "HDFC0001234", amount: slip(asha).netPay },
      { code: "PV002", name: "Kiran Test", bankName: null, account: null, ifsc: null, amount: slip(kiran).netPay },
    ]);
    const onScreen = run(maker, "bank-advice", { run: String(runId) });
    expect(onScreen.rows[0]!.account).toMatch(/^X+5678$/);
    expect(onScreen.note).toMatch(/masked/);
  });

  it("split the employer cost by department", () => {
    approve();
    const rows = run(maker, "employer-cost", { period: "2026-11" }).rows;
    const a = slip(asha);
    expect(rows[0]).toMatchObject({ department: "Engineering", people: 1, gross: a.grossEarnings, employer: a.employerContributions, cost: a.grossEarnings + a.employerContributions + a.reimbursements });
    expect(rows.map((r) => r.department)).toEqual(["Engineering", "Sales"]);
    expect(rows.reduce((s, r) => s + (r.share as number), 0)).toBeCloseTo(100, 0);
  });

  it("build one employee's year-to-date statement from released payslips", () => {
    expect(run(maker, "ytd-statement").note).toBe("Choose an employee.");
    approve();
    db.update(payslips).set({ releasedAt: NOW.toISOString() }).run();
    const result = run(maker, "ytd-statement", { employee: String(asha.id), fy: "2026" });
    expect(result.columns.map((c) => c.key)).toEqual(["component", "kind", "2026-11", "total"]);
    expect(result.rows.find((r) => r.component === "Bonus")).toMatchObject({ "2026-11": 500_050, total: 500_050 });
    expect(result.rows.at(-1)).toEqual({ component: "Net pay", kind: "Total", "2026-11": slip(asha).netPay, total: slip(asha).netPay });
  });

  it("list loans with what is outstanding", () => {
    createLoan(db, maker.id, { employeeId: kiran.id, type: "advance", principal: 5_000_000, emi: 1_000_000, startPeriod: "2026-12", note: "Relocation" });
    expect(run(maker, "loan-register").rows).toEqual([
      {
        code: "PV002", name: "Kiran Test", department: "Sales", type: "Advance", start: "December 2026", principal: 5_000_000, emi: 1_000_000, repaid: 0,
        outstanding: 5_000_000, status: "Active", note: "Relocation",
      },
    ]);
  });

  it("list claims dated in the range, without drafts", () => {
    const claim = (e: EmployeeRow, claimDate: string, status: "draft" | "approved" | "submitted", approverId: number | null = null) =>
      db.insert(expenseClaims).values({ employeeId: e.id, category: "travel", claimDate, amount: 120_000, description: "Cab", status, approverId }).run();
    claim(asha, "2026-11-05", "approved", checker.id);
    claim(kiran, "2026-11-06", "draft");
    claim(kiran, "2026-10-01", "submitted");
    expect(run(maker, "claims-register", { from: "2026-11-01", to: "2026-11-30" }).rows).toEqual([
      { date: "2026-11-05", code: "PV001", name: "Asha Test", category: "Travel", description: "Cab", amount: 120_000, status: "Approved", approvedBy: "Checker", paidIn: null },
    ]);
  });

  it("list salary revisions with the change from the one before", () => {
    const rows = run(maker, "salary-revisions", { from: "2026-01-01", to: "2026-12-31" }).rows;
    expect(rows.map((r) => [r.code, r.effective, r.previous, r.change])).toEqual([
      ["PV001", "2026-01-01", null, null], ["PV002", "2026-01-01", null, null], ["PV001", "2026-10-01", 120_000_000, 25],
    ]);
    expect(run(maker, "salary-revisions", { from: "2026-10-01", to: "2026-12-31" }).rows).toEqual([
      expect.objectContaining({ name: "Asha Test", structure: expect.any(String), ctc: 150_000_000, previous: 120_000_000, change: 25, reason: "Promotion", by: "Maker" }),
    ]);
  });
});
