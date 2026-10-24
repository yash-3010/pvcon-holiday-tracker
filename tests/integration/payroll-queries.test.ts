import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { expenseClaims, loanRepayments, loans, payslips, payslipVerifications, salaryStructures, type EmployeeRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { componentByCode } from "@/server/modules/payroll/components";
import { addManualInput } from "@/server/modules/payroll/inputs";
import {
  employeeSalaryView, listClaims, listLoans, listRuns, listSalaries, myClaims, myPayslips, myYearStatement, payslipDetail, pendingClaimsFor,
  runDetail, structureOptions, verificationLog,
} from "@/server/modules/payroll/queries";
import { approveRun, computeRun, createRun } from "@/server/modules/payroll/runs";
import { reviseSalary } from "@/server/modules/payroll/salaries";
import { seedPayrollDefaults } from "@/server/modules/payroll/structures";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

let db: DB;
let makerId: number;
let checkerId: number;
type Person = { employee: EmployeeRow; user: SessionUser };
let ravi: Person, asha: Person, kiran: Person;
const after = (period: string) => {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { today: `${next}-02`, now: new Date(`${next}-02T06:00:00Z`) };
};
const NOV = after("2026-11");
function person(name: string, overrides: Partial<EmployeeRow> = {}): Person {
  const login = insertUser(db, { name });
  const employee = insertEmployee(db, { firstName: name, lastName: "Test", dateOfJoining: "2024-03-15", userId: login.id, ...overrides });
  return { employee, user: sessionUserFor(db, login) };
}
const computed = (period: string, bonus = 0) => {
  const run = createRun(db, makerId, { period, type: "regular", notes: null }, after(period));
  if (bonus) addManualInput(db, makerId, { runId: run.id, employeeId: asha.employee.id, componentId: componentByCode(db, "BONUS")!.id, amount: bonus, note: "Spot" });
  computeRun(db, makerId, run.id, after(period));
  return run;
};
const releaseAll = (runId: number, at: string) => {
  db.update(payslips).set({ releasedAt: at }).where(eq(payslips.runId, runId)).run();
};

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db, { attendanceMode: "auto" });
  seedDefaultLeaveTypes(db);
  seedPayrollDefaults(db);
  makerId = insertUser(db, { roles: ["payroll_admin"] }).id;
  checkerId = insertUser(db, { roles: ["super_admin"] }).id;
  ravi = person("Ravi");
  asha = person("Asha", { reportingManagerId: ravi.employee.id });
  kiran = person("Kiran", { reportingManagerId: ravi.employee.id });
  ravi = { ...ravi, user: sessionUserFor(db, getUserById(db, ravi.user.id)!) };
  // Meena has no salary.
  insertEmployee(db, { firstName: "Meena", lastName: "Test", dateOfJoining: "2024-03-15" });
  const structureId = db.select().from(salaryStructures).get()!.id;
  for (const e of [ravi.employee, asha.employee, kiran.employee]) {
    reviseSalary(db, makerId, { employeeId: e.id, effectiveFrom: "2026-04-01", annualCtc: 120_000_000, structureId, overrides: {}, reason: null });
  }
});

describe("runs", () => {
  it("lists runs with totals and flags big changes against the previous period", () => {
    const oct = computed("2026-10");
    approveRun(db, checkerId, oct.id, after("2026-10"));
    const nov = computed("2026-11", 2_000_000);
    expect(listRuns(db).map((r) => [r.period, r.status, r.payslips, r.netPay])).toEqual([
      ["2026-11", "computed", 3, 32_000_000], ["2026-10", "approved", 3, 30_000_000],
    ]);

    const detail = runDetail(db, nov.id)!;
    expect(detail.run.warnings).toEqual(["No salary for Meena Test"]);
    expect(detail.computedByName).toBe("Test User");
    const a = detail.rows.find((r) => r.employeeId === asha.employee.id)!;
    expect(a).toMatchObject({ name: "Asha Test", netPay: 12_000_000, previousNetPay: 10_000_000, variancePct: 20, flagged: true });
    expect(detail.rows.find((r) => r.employeeId === kiran.employee.id)).toMatchObject({ variancePct: 0, flagged: false });
    expect(detail.inputs.map((i) => [i.employeeName, i.componentCode, i.amount, i.source])).toEqual([["Asha Test", "BONUS", 2_000_000, "manual"]]);
    expect(detail.totals).toMatchObject({ grossEarnings: 32_000_000, netPay: 32_000_000, included: 3 });

    const slip = payslipDetail(db, a.payslipId)!;
    expect(slip.lines.map((l) => [l.code, l.amount, l.explanation])).toContainEqual(["BASIC", 5_000_000, "= MONTHLY_CTC * 0.5"]);
    expect(slip).toMatchObject({ period: "2026-11", runType: "regular", runStatus: "computed" });
  });
});

describe("my payslips", () => {
  it("shows released payslips only, and a statement of the fiscal year", () => {
    const oct = computed("2026-10");
    approveRun(db, checkerId, oct.id, after("2026-10"));
    releaseAll(oct.id, "2026-11-01T06:00:00.000Z");
    const nov = computed("2026-11", 2_000_000);
    approveRun(db, checkerId, nov.id, NOV);
    expect(myPayslips(db, asha.employee.id).map((p) => [p.period, p.netPay])).toEqual([["2026-10", 10_000_000]]);
    releaseAll(nov.id, "2026-12-01T06:00:00.000Z");
    expect(myPayslips(db, asha.employee.id).map((p) => p.period)).toEqual(["2026-11", "2026-10"]);

    const statement = myYearStatement(db, asha.employee.id, "2026-11", 4);
    expect(statement.fiscalYear).toBe("FY 2026–27");
    expect(statement.periods).toEqual(["2026-10", "2026-11"]);
    expect(statement.lines.find((l) => l.code === "BASIC")).toMatchObject({ kind: "earning", amounts: [5_000_000, 5_000_000], total: 10_000_000 });
    expect(statement.lines.find((l) => l.code === "BONUS")).toMatchObject({ amounts: [0, 2_000_000], total: 2_000_000 });
    expect(statement.totals).toMatchObject({ grossEarnings: 22_000_000, netPay: 22_000_000 });
  });
});

describe("salary views", () => {
  it("shows the current breakdown and the history, marking corrected revisions", () => {
    const structureId = db.select().from(salaryStructures).get()!.id;
    const raise = reviseSalary(db, makerId, {
      employeeId: asha.employee.id, effectiveFrom: "2026-10-01", annualCtc: 150_000_000, structureId, overrides: { HRA: 2_000_000 }, reason: "Promotion",
    });
    const view = employeeSalaryView(db, asha.employee.id, "2026-11")!;
    expect(view.current).toMatchObject({ salaryId: raise.id, annualCtc: 150_000_000, structure: "Standard", effectiveFrom: "2026-10-01" });
    expect(view.current!.lines.map((l) => [l.code, l.monthly, l.annual])).toEqual([
      ["BASIC", 6_250_000, 75_000_000], ["HRA", 2_000_000, 24_000_000], ["SPECIAL", 4_250_000, 51_000_000],
    ]);
    expect(view.history.map((h) => [h.effectiveFrom, h.annualCtc, h.reason, h.createdByName])).toEqual([
      ["2026-10-01", 150_000_000, "Promotion", "Test User"], ["2026-04-01", 120_000_000, null, "Test User"],
    ]);
    expect(employeeSalaryView(db, insertEmployee(db).id, "2026-11")).toEqual({ current: null, history: [] });
    expect(structureOptions(db).map((s) => [s.name, s.components.map((c) => c.code).slice(0, 3)])).toEqual([["Standard", ["BASIC", "HRA", "SPECIAL"]]]);
  });
});

describe("salaries, loans and claims", () => {
  it("lists current salaries, loans with their outstanding and claims", () => {
    expect(listSalaries(db, { period: "2026-11" }).map((s) => [s.name, s.annualCtc, s.structure])).toEqual([
      ["Ravi Test", 120_000_000, "Standard"], ["Asha Test", 120_000_000, "Standard"], ["Kiran Test", 120_000_000, "Standard"], ["Meena Test", null, null],
    ]);

    const loan = db.insert(loans).values({ employeeId: kiran.employee.id, principal: 1_000_000, emi: 400_000, startPeriod: "2026-09" }).returning().get();
    const oct = computed("2026-10");
    db.insert(loanRepayments).values({ loanId: loan.id, runId: oct.id, period: "2026-10", amount: 400_000 }).run();
    expect(listLoans(db, {}).map((l) => [l.employeeName, l.repaid, l.outstanding, l.status])).toEqual([["Kiran Test", 400_000, 600_000, "active"]]);

    db.insert(expenseClaims).values([
      { employeeId: asha.employee.id, category: "travel", claimDate: "2026-11-02", amount: 120_000, description: "Cab", status: "submitted", submittedAt: "2026-11-03T06:00:00.000Z" },
      { employeeId: kiran.employee.id, category: "meals", claimDate: "2026-11-04", amount: 50_000, description: "Lunch", status: "draft" },
    ]).run();
    expect(pendingClaimsFor(db, ravi.user).map((c) => c.employeeName)).toEqual(["Asha Test"]);
    expect(pendingClaimsFor(db, kiran.user)).toEqual([]);
    expect(myClaims(db, kiran.employee.id).map((c) => c.status)).toEqual(["draft"]);
    expect(listClaims(db, { status: "submitted" }).map((c) => [c.employeeName, c.amount])).toEqual([["Asha Test", 120_000]]);
  });

  it("shows the verification log", () => {
    const nov = computed("2026-11");
    const slip = db.select().from(payslips).where(eq(payslips.runId, nov.id)).get()!;
    db.update(payslips).set({ verificationCode: "K7QX2M9PWD4R", releasedAt: "2026-12-01T06:00:00.000Z" }).where(eq(payslips.id, slip.id)).run();
    db.insert(payslipVerifications).values({ payslipId: slip.id, ip: "203.0.113.9", amountChecked: true, matched: false, at: "2026-12-05T06:00:00.000Z" }).run();
    expect(verificationLog(db, { limit: 10 })).toEqual([
      { id: 1, at: "2026-12-05T06:00:00.000Z", ip: "203.0.113.9", amountChecked: true, matched: false, code: "K7QX2M9PWD4R", period: "2026-11", employeeName: slip.snapshot.name },
    ]);
  });
});
