import ExcelJS from "exceljs";
import { asc, eq, inArray } from "drizzle-orm";
import Papa from "papaparse";
import { toMajor, type Minor } from "@/lib/money";
import { PAYSLIP_STATUS_LABELS } from "@/lib/payroll/constants";
import type { DbLike } from "@/server/db/client";
import { employees, payslipLines, payslips, salaryComponents } from "@/server/db/schema";
import { openBank } from "@/server/modules/employees/sensitive";
import { requireRun } from "./inputs";

export interface BankAdviceRow {
  code: string;
  name: string;
  bankName: string | null;
  account: string | null;
  ifsc: string | null;
  amount: Minor;
}

/** Text a spreadsheet would read as a formula gets a leading apostrophe. */
function safeText(value: string | null): string {
  if (!value) return "";
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * The bank transfer list of a run (spec §5.6 run step 7): included payslips with the full account number from the
 * employee's current bank details. Held and excluded payslips aren't paid yet.
 */
export function bankAdvice(db: DbLike, runId: number): BankAdviceRow[] {
  requireRun(db, runId);
  return db
    .select({ payslip: payslips, employee: employees })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(eq(payslips.runId, runId))
    .orderBy(asc(employees.employeeCode))
    .all()
    .filter(({ payslip }) => payslip.status === "ok")
    .map(({ payslip, employee }) => {
      const bank = openBank(employee);
      return {
        code: employee.employeeCode, name: employee.displayName, bankName: bank.bankName, account: bank.bankAccount, ifsc: bank.bankIfsc,
        amount: payslip.netPay,
      };
    });
}

const BANK_HEADERS = ["Employee code", "Name", "Bank", "Account number", "IFSC", "Amount"];

export function bankAdviceCsv(rows: readonly BankAdviceRow[]): string {
  return Papa.unparse({
    fields: BANK_HEADERS,
    data: rows.map((r) => [safeText(r.code), safeText(r.name), safeText(r.bankName), safeText(r.account), safeText(r.ifsc), toMajor(r.amount).toFixed(2)]),
  });
}

function styleHeader(sheet: ExcelJS.Worksheet): void {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

export async function bankAdviceXlsx(rows: readonly BankAdviceRow[], periodLabel: string): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "PVCON People";
  const sheet = book.addWorksheet("Bank advice");
  sheet.columns = BANK_HEADERS.map((header, i) => ({ header, width: [14, 28, 22, 22, 14, 16][i] }));
  for (const r of rows) {
    sheet.addRow([safeText(r.code), safeText(r.name), safeText(r.bankName), safeText(r.account), safeText(r.ifsc), toMajor(r.amount)]);
  }
  sheet.addRow(["Total", null, null, null, null, toMajor(rows.reduce((s, r) => s + r.amount, 0))]).font = { bold: true };
  sheet.getColumn(4).numFmt = "@";
  sheet.getColumn(6).numFmt = "#,##0.00";
  styleHeader(sheet);
  book.title = `Bank advice ${periodLabel}`;
  return Buffer.from(await book.xlsx.writeBuffer());
}

const SOURCE_SUFFIX: Record<string, string> = { claim: " (claims)", loan: "", arrear: " (arrears)", encashment: " (encashment)", manual: "" };

/** One row per payslip, a column per component (arrears and claims apart), days and totals. */
export async function registerXlsx(db: DbLike, runId: number): Promise<Buffer> {
  const run = requireRun(db, runId);
  const rows = db
    .select({ payslip: payslips, employee: employees })
    .from(payslips)
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .where(eq(payslips.runId, runId))
    .orderBy(asc(employees.employeeCode))
    .all();
  const ids = rows.map((r) => r.payslip.id);
  const lines = ids.length ? db.select().from(payslipLines).where(inArray(payslipLines.payslipId, ids)).orderBy(asc(payslipLines.sortOrder)).all() : [];
  const names = new Map(db.select({ code: salaryComponents.code, name: salaryComponents.name }).from(salaryComponents).all().map((c) => [c.code, c.name]));

  // Columns in the order components first appear, structure lines before input lines.
  const columns = new Map<string, string>();
  const columnOf = (l: (typeof lines)[number]) => (l.source === "component" || l.source === "manual" ? l.componentCode : `${l.componentCode}|${l.source}`);
  for (const l of [...lines].sort((a, b) => Number(a.source !== "component") - Number(b.source !== "component"))) {
    const key = columnOf(l);
    if (!columns.has(key)) columns.set(key, `${names.get(l.componentCode) ?? l.componentName}${SOURCE_SUFFIX[l.source] ?? ""}`);
  }

  const book = new ExcelJS.Workbook();
  book.creator = "PVCON People";
  const sheet = book.addWorksheet(`Register ${run.period}`);
  const keys = [...columns.keys()];
  sheet.addRow([
    "Employee code", "Name", "Status", "Total days", "Paid days", "LOP days", ...keys.map((k) => columns.get(k)!),
    "Gross earnings", "Deductions", "Employer contributions", "Reimbursements", "Net pay",
  ]);
  for (const { payslip, employee } of rows) {
    const amounts = new Map<string, Minor>();
    for (const l of lines.filter((x) => x.payslipId === payslip.id)) amounts.set(columnOf(l), (amounts.get(columnOf(l)) ?? 0) + l.amount);
    sheet.addRow([
      safeText(employee.employeeCode), safeText(employee.displayName), PAYSLIP_STATUS_LABELS[payslip.status], payslip.totalDays, payslip.paidDays,
      payslip.lopDays, ...keys.map((k) => toMajor(amounts.get(k) ?? 0)), toMajor(payslip.grossEarnings), toMajor(payslip.totalDeductions),
      toMajor(payslip.employerContributions), toMajor(payslip.reimbursements), toMajor(payslip.netPay),
    ]);
  }
  const included = rows.filter((r) => r.payslip.status !== "excluded").map((r) => r.payslip);
  const sum = (pick: (p: (typeof included)[number]) => Minor) => toMajor(included.reduce((s, p) => s + pick(p), 0));
  sheet.addRow([
    "Total (included and held)", null, null, null, null, null, ...keys.map(() => null), sum((p) => p.grossEarnings), sum((p) => p.totalDeductions),
    sum((p) => p.employerContributions), sum((p) => p.reimbursements), sum((p) => p.netPay),
  ]).font = { bold: true };
  sheet.columns.forEach((c, i) => {
    c.width = i < 3 ? [14, 28, 12][i] : 14;
    if (i >= 6) c.numFmt = "#,##0.00";
  });
  styleHeader(sheet);
  return Buffer.from(await book.xlsx.writeBuffer());
}
