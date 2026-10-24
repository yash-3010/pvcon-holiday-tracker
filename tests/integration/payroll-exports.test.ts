import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { payslips, salaryStructures, type EmployeeRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { updateEmployeeBank } from "@/server/modules/employees/service";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { componentByCode } from "@/server/modules/payroll/components";
import { bankAdvice, bankAdviceCsv, bankAdviceXlsx, registerXlsx } from "@/server/modules/payroll/exports";
import { addManualInput } from "@/server/modules/payroll/inputs";
import { computeRun, createRun, setPayslipStatus } from "@/server/modules/payroll/runs";
import { reviseSalary } from "@/server/modules/payroll/salaries";
import { seedPayrollDefaults } from "@/server/modules/payroll/structures";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser } from "../helpers/fixtures";

const NOV = { today: "2026-12-02", now: new Date("2026-12-02T06:00:00Z") };
let db: DB;
let runId: number;
let asha: EmployeeRow;
let mallory: EmployeeRow;
let kiran: EmployeeRow;
const bank = (account: string) => ({ bankName: "HDFC Bank", bankAccount: account, bankIfsc: "HDFC0001234", pan: null, aadhaar: null, passport: null });
const sheetRows = async (data: Buffer) => {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(data as unknown as ExcelJS.Buffer);
  const sheet = book.worksheets[0]!;
  const rows: unknown[][] = [];
  sheet.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  return { name: sheet.name, rows };
};

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db, { attendanceMode: "auto" });
  seedDefaultLeaveTypes(db);
  seedPayrollDefaults(db);
  const hrId = insertUser(db, { roles: ["payroll_admin"] }).id;
  asha = insertEmployee(db, { firstName: "Asha", lastName: "Rao", employeeCode: "PV001", dateOfJoining: "2024-03-15" });
  mallory = insertEmployee(db, { firstName: "=HYPERLINK(\"x\")", lastName: "M", employeeCode: "PV002", dateOfJoining: "2024-03-15" });
  kiran = insertEmployee(db, { firstName: "Kiran", lastName: "Das", employeeCode: "PV003", dateOfJoining: "2024-03-15" });
  const structureId = db.select().from(salaryStructures).get()!.id;
  for (const e of [asha, mallory, kiran]) {
    reviseSalary(db, hrId, { employeeId: e.id, effectiveFrom: "2026-01-01", annualCtc: 120_000_000, structureId, overrides: {}, reason: null });
  }
  updateEmployeeBank(db, asha.id, bank("50100012345678"));
  updateEmployeeBank(db, mallory.id, bank("50100087654321"));
  runId = createRun(db, hrId, { period: "2026-11", type: "regular", notes: null }, NOV).id;
  addManualInput(db, hrId, { runId, employeeId: asha.id, componentId: componentByCode(db, "BONUS")!.id, amount: 500_050, note: null });
  computeRun(db, hrId, runId, NOV);
  setPayslipStatus(db, runId, kiran.id, "hold");
});

describe("bank advice", () => {
  it("lists included payslips with full account numbers", () => {
    expect(bankAdvice(db, runId)).toEqual([
      { code: "PV001", name: "Asha Rao", bankName: "HDFC Bank", account: "50100012345678", ifsc: "HDFC0001234", amount: 10_500_050 },
      { code: "PV002", name: "=HYPERLINK(\"x\") M", bankName: "HDFC Bank", account: "50100087654321", ifsc: "HDFC0001234", amount: 10_000_000 },
    ]);
  });

  it("exports CSV with a formula guard and XLSX with text cells", async () => {
    const csv = bankAdviceCsv(bankAdvice(db, runId));
    expect(csv.split("\r\n")).toEqual([
      "Employee code,Name,Bank,Account number,IFSC,Amount",
      "PV001,Asha Rao,HDFC Bank,50100012345678,HDFC0001234,105000.50",
      "PV002,\"'=HYPERLINK(\"\"x\"\") M\",HDFC Bank,50100087654321,HDFC0001234,100000.00",
    ]);
    const { rows } = await sheetRows(await bankAdviceXlsx(bankAdvice(db, runId), "November 2026"));
    expect(rows[1]).toEqual(["PV001", "Asha Rao", "HDFC Bank", "50100012345678", "HDFC0001234", 105000.5]);
    // XLSX string cells are never evaluated: the name stays as typed. The CSV above carries the formula guard.
    expect(rows[2]![1]).toBe("=HYPERLINK(\"x\") M");
    expect(rows.at(-1)).toEqual(["Total", undefined, undefined, undefined, undefined, 205000.5]);
  });
});

describe("register", () => {
  it("has a row per payslip with a column per component and the totals", async () => {
    const { name, rows } = await sheetRows(await registerXlsx(db, runId));
    expect(name).toBe("Register 2026-11");
    expect(rows[0]).toEqual([
      "Employee code", "Name", "Status", "Total days", "Paid days", "LOP days", "Basic", "House rent allowance", "Special allowance", "Bonus",
      "Gross earnings", "Deductions", "Employer contributions", "Reimbursements", "Net pay",
    ]);
    expect(rows[1]).toEqual(["PV001", "Asha Rao", "Included", 30, 30, 0, 50000, 20000, 30000, 5000.5, 105000.5, 0, 0, 0, 105000.5]);
    expect(rows[3]!.slice(0, 3)).toEqual(["PV003", "Kiran Das", "On hold"]);
    expect(db.select().from(payslips).where(and(eq(payslips.runId, runId), eq(payslips.employeeId, kiran.id))).get()!.status).toBe("hold");
  });
});
