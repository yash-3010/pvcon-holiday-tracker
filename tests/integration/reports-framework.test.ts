import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { reportCsv, reportXlsx } from "@/server/modules/reports/export";
import { canRunReport, parseReportParams, reportScope } from "@/server/modules/reports/scope";
import type { ReportDefinition, ReportResult } from "@/server/modules/reports/types";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

let db: DB;
const report: ReportDefinition = {
  slug: "demo", area: "attendance", title: "Demo", description: "", permissions: ["report.attendance"], orgWide: "attendance.view.all",
  filters: [], run: () => ({ columns: [], rows: [] }),
};
const result: ReportResult = {
  columns: [
    { key: "name", label: "Name", type: "text" }, { key: "pay", label: "Pay", type: "money" }, { key: "time", label: "Time", type: "minutes" },
    { key: "share", label: "Share", type: "percent" },
  ],
  rows: [{ name: "=cmd()", pay: 12_345_678, time: 90, share: 12.5 }, { name: "Asha", pay: null, time: 0, share: null }],
  note: "Money in rupees.",
};

beforeEach(() => {
  db = createTestDb();
});

describe("report scope and parameters", () => {
  it("lets org-wide viewers see everyone and managers their tree, and nobody without the permission run it", () => {
    const hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
    const managerLogin = insertUser(db, { roles: ["manager"] });
    const boss = insertEmployee(db, { userId: managerLogin.id });
    const report1 = insertEmployee(db, { reportingManagerId: boss.id });
    const report2 = insertEmployee(db, { reportingManagerId: report1.id });
    insertEmployee(db);
    const manager = sessionUserFor(db, getUserById(db, managerLogin.id)!);
    const employee = sessionUserFor(db, insertUser(db));
    expect([hr, manager, employee].map((u) => canRunReport(u, report))).toEqual([true, true, false]);
    expect(reportScope(db, hr, report)).toBeNull();
    expect(reportScope(db, manager, report)?.sort()).toEqual([report1.id, report2.id].sort());
  });

  it("reads filters with sensible defaults and drops employees outside the scope", () => {
    const today = "2026-11-10";
    expect(parseReportParams(db, {}, { today, scope: null })).toMatchObject({
      period: "2026-10", from: "2026-11-01", to: today, date: today, week: "2026-11-02", employeeId: null,
      fiscalYear: { start: "2026-04", end: "2027-03", label: "FY 2026–27" },
    });
    expect(parseReportParams(db, { fy: "2024" }, { today: "2027-04-10", scope: null }).fiscalYear.start).toBe("2024-04");
    expect(parseReportParams(db, {}, { today: "2027-04-10", scope: null }).fiscalYear.start).toBe("2026-04");
    expect(parseReportParams(db, { from: "2026-11-09", to: "2026-11-01", week: "2026-11-12", employee: "7" }, { today, scope: [3] })).toMatchObject({
      from: "2026-11-01", to: "2026-11-09", week: "2026-11-09", employeeId: null,
    });
    expect(parseReportParams(db, { employee: "3", period: "2026-13" }, { today, scope: [3] })).toMatchObject({ employeeId: 3, period: "2026-10" });
  });
});

describe("report exports", () => {
  it("write CSV with units in the headers, rupees and hours, and no formulas", () => {
    expect(reportCsv(result).replace(/^﻿/, "").split("\r\n")).toEqual([
      "Name,Pay (₹),Time (h),Share (%)", "'=cmd(),123456.78,1.5,12.5", "Asha,,0,",
    ]);
  });

  it("write XLSX with typed cells and the note", async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await reportXlsx("Demo: report/1", result)) as unknown as ExcelJS.Buffer);
    const sheet = book.worksheets[0]!;
    expect(sheet.name).toBe("Demo  report 1");
    expect(sheet.getRow(2).values).toEqual([undefined, "'=cmd()", 123456.78, 1.5, 12.5]);
    expect(sheet.getRow(5).getCell(1).value).toBe("Money in rupees.");
  });
});
