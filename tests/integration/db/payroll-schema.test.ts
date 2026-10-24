import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { payrollInputs, payrollRuns, payslipLines, payslips, salaryComponents } from "@/server/db/schema";
import { createTestDb } from "../../helpers/db";
import { insertEmployee } from "../../helpers/employees";

const snapshot = {
  name: "Asha", code: "PV0001", designation: null, department: null, dateOfJoining: "2025-01-01", bankName: null, bankAccountMasked: null,
  bankIfsc: null, pan: null, annualCtc: 120_000_000, structure: "Standard",
};

describe("payroll schema", () => {
  it("creates the payroll tables", () => {
    const db = createTestDb();
    const names = db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "salary_components", "salary_structures", "salary_structure_components", "employee_salaries", "payroll_runs", "payroll_inputs",
        "payslips", "payslip_lines", "payslip_verifications", "loans", "loan_repayments", "expense_claims",
      ]),
    );
  });

  it("keeps one live regular run per period", () => {
    const db = createTestDb();
    const first = db.insert(payrollRuns).values({ period: "2026-10" }).returning().get();
    expect(first).toMatchObject({ type: "regular", status: "draft", warnings: [] });
    expect(() => db.insert(payrollRuns).values({ period: "2026-10" }).run()).toThrow(/UNIQUE/);
    db.insert(payrollRuns).values({ period: "2026-10", type: "off_cycle" }).run();
    db.update(payrollRuns).set({ status: "cancelled" }).where(eq(payrollRuns.id, first.id)).run();
    db.insert(payrollRuns).values({ period: "2026-10" }).run();
    expect(db.select().from(payrollRuns).all()).toHaveLength(3);
  });

  it("drops payslips, lines and inputs with their run", () => {
    const db = createTestDb();
    const e = insertEmployee(db);
    const run = db.insert(payrollRuns).values({ period: "2026-10" }).returning().get();
    const component = db.insert(salaryComponents).values({ code: "BONUS", name: "Bonus", kind: "earning", calc: "input" }).returning().get();
    const slip = db.insert(payslips).values({ runId: run.id, employeeId: e.id, snapshot, variables: { PAID_DAYS: 31 } }).returning().get();
    expect(slip).toMatchObject({ status: "ok", netPay: 0, warnings: [], signed: false, verificationCode: null });
    expect(() => db.insert(payslips).values({ runId: run.id, employeeId: e.id, snapshot, variables: {} }).run()).toThrow(/UNIQUE/);
    db.insert(payslipLines).values({ payslipId: slip.id, componentCode: "BONUS", componentName: "Bonus", kind: "earning", amount: 100 }).run();
    db.insert(payrollInputs).values({ runId: run.id, employeeId: e.id, componentId: component.id, amount: 100, label: "Bonus" }).run();
    db.delete(payrollRuns).where(eq(payrollRuns.id, run.id)).run();
    expect([db.select().from(payslips).all(), db.select().from(payslipLines).all(), db.select().from(payrollInputs).all()]).toEqual([[], [], []]);
  });
});
