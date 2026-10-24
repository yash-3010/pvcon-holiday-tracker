import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import {
  employees, employeeSalaries, expenseClaims, loanRepayments, loans, payrollInputs, payrollRuns, payslipLines, payslips, salaryStructures,
  type EmployeeRow,
} from "@/server/db/schema";
import { setOverride } from "@/server/modules/attendance/overrides";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { updateEmployeeBank } from "@/server/modules/employees/service";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { componentByCode } from "@/server/modules/payroll/components";
import { addManualInput, deleteInput, importInputs, refreshSystemInputs } from "@/server/modules/payroll/inputs";
import { computeRun, createRun, requireRun, setPayslipStatus } from "@/server/modules/payroll/runs";
import { reviseSalary } from "@/server/modules/payroll/salaries";
import { seedPayrollDefaults } from "@/server/modules/payroll/structures";
import { createTestDb } from "../helpers/db";
import { insertDepartment, insertDesignation, insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser } from "../helpers/fixtures";

let db: DB;
let hrId: number;
let asha: EmployeeRow;
let ravi: EmployeeRow;
let kiran: EmployeeRow;
let meena: EmployeeRow;
// November 2026 has ended.
const AFTER = { today: "2026-12-02", now: new Date("2026-12-02T06:00:00Z") };
const standardId = () => db.select().from(salaryStructures).get()!.id;
const salary = (employeeId: number, annualCtc: number, effectiveFrom = "2026-01-01") =>
  reviseSalary(db, hrId, { employeeId, effectiveFrom, annualCtc, structureId: standardId(), overrides: {}, reason: null });
const component = (code: string) => componentByCode(db, code)!.id;
const run = (period = "2026-11", type: "regular" | "off_cycle" = "regular", today = AFTER.today) =>
  createRun(db, hrId, { period, type, notes: null }, { today });
const slipOf = (runId: number, employeeId: number) =>
  db.select().from(payslips).all().find((p) => p.runId === runId && p.employeeId === employeeId);
const linesOf = (payslipId: number) =>
  db.select().from(payslipLines).where(eq(payslipLines.payslipId, payslipId)).all().map((l) => [l.componentCode, l.amount]);

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db, { attendanceMode: "auto" });
  seedDefaultLeaveTypes(db);
  seedPayrollDefaults(db);
  hrId = insertUser(db, { roles: ["payroll_admin"] }).id;
  asha = insertEmployee(db, { firstName: "Asha", dateOfJoining: "2024-03-15" });
  ravi = insertEmployee(db, { firstName: "Ravi", dateOfJoining: "2026-11-16" });
  kiran = insertEmployee(db, { firstName: "Kiran", dateOfJoining: "2025-06-01" });
  meena = insertEmployee(db, { firstName: "Meena", dateOfJoining: "2025-06-01" });
});

describe("creating runs", () => {
  it("allows one regular run per period, in order, at most a month ahead", () => {
    const nov = run("2026-11", "regular", "2026-11-20");
    expect(nov).toMatchObject({ period: "2026-11", type: "regular", status: "draft", createdBy: hrId });
    expectDomainError(() => run("2026-11", "regular", "2026-11-20"), "DUPLICATE_RUN");
    expectDomainError(() => run("2026-12", "regular", "2026-11-20"), "PREVIOUS_OPEN");
    expectDomainError(() => run("2026-10", "regular", "2026-11-20"), "OUT_OF_ORDER");
    expectDomainError(() => run("2027-01", "off_cycle", "2026-11-20"), "TOO_EARLY");
    // Off-cycle runs sit outside the order.
    expect(run("2026-11", "off_cycle", "2026-11-20").type).toBe("off_cycle");
    expect(run("2026-11", "off_cycle", "2026-11-20").type).toBe("off_cycle");

    db.update(payrollRuns).set({ status: "approved" }).where(eq(payrollRuns.id, nov.id)).run();
    expect(run("2026-12", "regular", "2026-11-20").period).toBe("2026-12");
  });

  it("lets the very first regular run be any period, and a cancelled one be replaced", () => {
    const first = run("2026-08");
    db.update(payrollRuns).set({ status: "cancelled" }).where(eq(payrollRuns.id, first.id)).run();
    expect(run("2026-08").id).not.toBe(first.id);
  });
});

describe("inputs", () => {
  it("adds manual inputs to input components of employees in the period", () => {
    const nov = run();
    const input = addManualInput(db, hrId, { runId: nov.id, employeeId: asha.id, componentId: component("BONUS"), amount: 500_000, note: "Diwali" });
    expect(input).toMatchObject({ source: "manual", label: "Bonus", amount: 500_000, note: "Diwali", createdBy: hrId });
    expectDomainError(() => addManualInput(db, hrId, { runId: nov.id, employeeId: asha.id, componentId: component("BASIC"), amount: 1, note: null }), "NOT_INPUT");
    expectDomainError(() => addManualInput(db, hrId, { runId: nov.id, employeeId: asha.id, componentId: component("REIMB"), amount: 1, note: null }), "NOT_INPUT");
    const gone = insertEmployee(db, { status: "exited", lastWorkingDate: "2026-10-15" });
    expectDomainError(() => addManualInput(db, hrId, { runId: nov.id, employeeId: gone.id, componentId: component("BONUS"), amount: 1, note: null }), "NOT_EMPLOYED");
    deleteInput(db, input.id);
    expect(db.select().from(payrollInputs).all()).toEqual([]);
  });

  it("imports a CSV all or nothing", () => {
    const nov = run();
    const bad = importInputs(db, hrId, nov.id, `employee_code,component_code,amount,note\n${asha.employeeCode},BONUS,2500.50,Spot\nNOPE,BONUS,10,\n${kiran.employeeCode},BASIC,5,\n`);
    expect(bad).toEqual({ added: 0, errors: ["Row 2: no employee NOPE", "Row 3: BASIC is not entered per run"] });
    expect(db.select().from(payrollInputs).all()).toEqual([]);
    const good = importInputs(db, hrId, nov.id, `Employee_Code,Component_Code,Amount,Note\n${asha.employeeCode},BONUS,2500.50,Spot\n${kiran.employeeCode},OTHER_DEDUCTION,300,Canteen\n`);
    expect(good).toEqual({ added: 2, errors: [] });
    expect(db.select().from(payrollInputs).all().map((i) => [i.employeeId, i.amount, i.note])).toEqual([[asha.id, 250_050, "Spot"], [kiran.id, 30_000, "Canteen"]]);
  });

  it("collects approved unpaid claims and loan EMIs, capped at the outstanding", () => {
    const nov = run();
    db.insert(expenseClaims).values([
      { employeeId: asha.id, category: "travel", claimDate: "2026-11-02", amount: 120_000, description: "Cab", status: "approved" },
      { employeeId: asha.id, category: "meals", claimDate: "2026-12-01", amount: 50_000, description: "Later", status: "approved" },
      { employeeId: asha.id, category: "meals", claimDate: "2026-11-03", amount: 50_000, description: "Pending", status: "submitted" },
    ]).run();
    const loan = db.insert(loans).values({ employeeId: kiran.id, principal: 1_000_000, emi: 400_000, startPeriod: "2026-09" }).returning().get();
    db.insert(loans).values({ employeeId: kiran.id, principal: 1_000_000, emi: 400_000, startPeriod: "2026-12" }).run();
    db.insert(loans).values({ employeeId: asha.id, principal: 1_000_000, emi: 400_000, startPeriod: "2026-09", status: "paused" }).run();
    const earlier = db.insert(payrollRuns).values({ period: "2026-10", status: "approved" }).returning().get();
    db.insert(loanRepayments).values({ loanId: loan.id, runId: earlier.id, period: "2026-10", amount: 800_000 }).run();
    addManualInput(db, hrId, { runId: nov.id, employeeId: asha.id, componentId: component("BONUS"), amount: 100, note: null });

    refreshSystemInputs(db, requireRun(db, nov.id));
    refreshSystemInputs(db, requireRun(db, nov.id));
    const inputs = db.select().from(payrollInputs).all();
    expect(inputs.map((i) => [i.employeeId, i.source, i.amount, i.label])).toEqual([
      [asha.id, "manual", 100, "Bonus"],
      [asha.id, "claim", 120_000, "Claim: Travel on 02 Nov 2026"],
      [kiran.id, "loan", 200_000, "Loan repayment"],
    ]);
    expectDomainError(() => deleteInput(db, inputs[1]!.id), "NOT_MANUAL");
  });
});

describe("computing a regular run", () => {
  beforeEach(() => {
    salary(asha.id, 120_000_000);
    salary(ravi.id, 60_000_000, "2026-11-01");
    salary(kiran.id, 120_000_000);
    for (const date of ["2026-11-03", "2026-11-04", "2026-11-05"]) {
      setOverride(db, hrId, { employeeId: kiran.id, date, status: "absent", note: "No show" }, AFTER);
    }
    const sales = insertDepartment(db, "Sales");
    const analyst = insertDesignation(db, "Analyst");
    db.update(employees).set({ departmentId: sales.id, designationId: analyst.id }).where(eq(employees.id, kiran.id)).run();
    updateEmployeeBank(db, kiran.id, { bankName: "HDFC", bankAccount: "50100012345678", bankIfsc: "HDFC0001234", pan: "ABCDE1234F", aadhaar: null, passport: null });
  });

  it("pays a full month, a joiner pro rata, loss of pay, and warns about a missing salary", () => {
    const nov = run();
    const result = computeRun(db, hrId, nov.id, AFTER);
    expect(result.run).toMatchObject({ status: "computed", computedBy: hrId, computedAt: AFTER.now.toISOString(), warnings: ["No salary for Meena Test"] });
    expect(result.payslips).toBe(3);
    expect(slipOf(nov.id, meena.id)).toBeUndefined();

    const a = slipOf(nov.id, asha.id)!;
    expect(a).toMatchObject({ totalDays: 30, paidDays: 30, lopDays: 0, grossEarnings: 10_000_000, netPay: 10_000_000, status: "ok", error: null });
    expect(a.warnings).toEqual(["No bank account"]);
    expect(linesOf(a.id)).toEqual([["BASIC", 5_000_000], ["HRA", 2_000_000], ["SPECIAL", 3_000_000]]);
    expect(a.variables).toMatchObject({ PAID_DAYS: 30, MONTHS_OF_SERVICE: 32 });

    const r = slipOf(nov.id, ravi.id)!;
    expect(r).toMatchObject({ paidDays: 15, lopDays: 15, grossEarnings: 2_500_000 });

    const k = slipOf(nov.id, kiran.id)!;
    expect(k).toMatchObject({ paidDays: 27, lopDays: 3, grossEarnings: 9_000_000, warnings: [] });
    expect(k.snapshot).toEqual({
      name: "Kiran Test", code: kiran.employeeCode, designation: "Analyst", department: "Sales", dateOfJoining: "2025-06-01",
      bankName: "HDFC", bankAccountMasked: "XXXX5678", bankIfsc: "HDFC0001234", pan: "XXXX234F", annualCtc: 120_000_000, structure: "Standard",
    });
    expect(k.salaryId).toBe(db.select().from(employeeSalaries).all().find((s) => s.employeeId === kiran.id)!.id);
  });

  it("keeps holds on recompute, sends a run back to draft when inputs change, and refuses a held error", () => {
    const nov = run();
    computeRun(db, hrId, nov.id, AFTER);
    setPayslipStatus(db, nov.id, asha.id, "hold");
    addManualInput(db, hrId, { runId: nov.id, employeeId: asha.id, componentId: component("BONUS"), amount: 500_000, note: null });
    expect(requireRun(db, nov.id).status).toBe("draft");
    computeRun(db, hrId, nov.id, AFTER);
    const a = slipOf(nov.id, asha.id)!;
    expect(a).toMatchObject({ status: "hold", grossEarnings: 10_500_000 });
    expect(linesOf(a.id)).toContainEqual(["BONUS", 500_000]);

    // A formula that fails for one employee excludes that payslip until it computes again.
    db.update(employeeSalaries).set({ overrides: { HRA: "BASIC / (PAID_DAYS - 27)" } }).where(eq(employeeSalaries.employeeId, kiran.id)).run();
    computeRun(db, hrId, nov.id, AFTER);
    expect(slipOf(nov.id, kiran.id)).toMatchObject({ status: "excluded", error: "HRA: Division by zero", netPay: 0 });
    expectDomainError(() => setPayslipStatus(db, nov.id, kiran.id, "ok"), "PAYSLIP_ERROR");
    db.update(employeeSalaries).set({ overrides: {} }).where(eq(employeeSalaries.employeeId, kiran.id)).run();
    computeRun(db, hrId, nov.id, AFTER);
    expect(slipOf(nov.id, kiran.id)).toMatchObject({ status: "ok", error: null, grossEarnings: 9_000_000 });

    db.update(payrollRuns).set({ status: "approved" }).where(eq(payrollRuns.id, nov.id)).run();
    expectDomainError(() => computeRun(db, hrId, nov.id, AFTER), "RUN_LOCKED");
    expectDomainError(() => setPayslipStatus(db, nov.id, asha.id, "ok"), "RUN_LOCKED");
  });

  it("pays an off-cycle bonus from inputs only", () => {
    const bonus = run("2026-11", "off_cycle");
    addManualInput(db, hrId, { runId: bonus.id, employeeId: asha.id, componentId: component("BONUS"), amount: 1_000_000, note: null });
    const kiranInput = addManualInput(db, hrId, { runId: bonus.id, employeeId: kiran.id, componentId: component("BONUS"), amount: 200_000, note: null });
    computeRun(db, hrId, bonus.id, AFTER);
    const a = slipOf(bonus.id, asha.id)!;
    expect(a).toMatchObject({ totalDays: 0, paidDays: 0, grossEarnings: 1_000_000, netPay: 1_000_000, salaryId: null });
    expect(linesOf(a.id)).toEqual([["BONUS", 1_000_000]]);
    expect(db.select().from(payslips).all().filter((p) => p.runId === bonus.id)).toHaveLength(2);
    deleteInput(db, kiranInput.id);
    computeRun(db, hrId, bonus.id, AFTER);
    expect(slipOf(bonus.id, kiran.id)).toBeUndefined();
  });
});
