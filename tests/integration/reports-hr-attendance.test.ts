import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { attendanceDays, attendancePunches, compOffClaims, type EmployeeRow } from "@/server/db/schema";
import { sealBank } from "@/server/modules/employees/sensitive";
import { runReport } from "@/server/modules/reports/registry";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertDepartment, insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

// Tuesday 10 Nov 2026, 12:00 in India.
const NOW = new Date("2026-11-10T06:30:00Z");
let db: DB;
let hr: SessionUser, manager: SessionUser, payroll: SessionUser;
let boss: EmployeeRow, asha: EmployeeRow, kiran: EmployeeRow, gone: EmployeeRow;
let eng: number, sales: number;

const run = (user: SessionUser, slug: string, raw: Record<string, string> = {}) => runReport(db, user, slug, raw, NOW).result;
const day = (e: EmployeeRow, date: string, status: typeof attendanceDays.$inferInsert.status, extra: Partial<typeof attendanceDays.$inferInsert> = {}) =>
  db.insert(attendanceDays).values({ employeeId: e.id, date, status, ...extra }).run();
const clockIn = (e: EmployeeRow, at: string, workMode: "office" | "remote") =>
  db.insert(attendancePunches).values({ employeeId: e.id, at, date: at.slice(0, 10), direction: "in", workMode }).run();

beforeEach(() => {
  db = createTestDb();
  eng = insertDepartment(db, "Engineering").id;
  sales = insertDepartment(db, "Sales").id;
  hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
  payroll = sessionUserFor(db, insertUser(db, { roles: ["payroll_admin"] }));
  const managerLogin = insertUser(db, { roles: ["manager"] });
  boss = insertEmployee(db, { firstName: "Boss", userId: managerLogin.id, departmentId: eng, dateOfJoining: "2020-11-12", dateOfBirth: "1980-11-20" });
  asha = insertEmployee(db, { firstName: "Asha", departmentId: eng, reportingManagerId: boss.id, dateOfJoining: "2026-10-05" });
  kiran = insertEmployee(db, {
    firstName: "Kiran", departmentId: sales, reportingManagerId: boss.id, dateOfJoining: "2025-06-01", employmentType: "contract",
    ...sealBank({ bankName: "HDFC", bankAccount: "123456789012", bankIfsc: "HDFC0000001", pan: "ABCDE1234F", aadhaar: null, passport: null }),
  });
  gone = insertEmployee(db, { firstName: "Gone", departmentId: sales, dateOfJoining: "2024-01-01", status: "exited", lastWorkingDate: "2026-10-15" });
  insertEmployee(db, { firstName: "Later", departmentId: eng, dateOfJoining: "2026-12-01" });
  manager = sessionUserFor(db, getUserById(db, managerLogin.id)!);
});

describe("HR reports", () => {
  it("counts heads by department on a date", () => {
    const result = run(hr, "headcount", { date: "2026-10-10" });
    expect(result.rows).toEqual([
      { department: "Engineering", headcount: 2, fullTime: 2, other: 0, tenure: 3 },
      { department: "Sales", headcount: 2, fullTime: 1, other: 1, tenure: 2.1 },
    ]);
    expect(run(hr, "headcount", { date: "2026-10-20", department: String(sales) }).rows).toEqual([
      { department: "Sales", headcount: 1, fullTime: 0, other: 1, tenure: 1.4 },
    ]);
  });

  it("lists joiners and leavers in a range, oldest first", () => {
    expect(run(hr, "joiners-leavers", { from: "2026-10-01", to: "2026-10-31" }).rows.map((r) => [r.date, r.event, r.name])).toEqual([
      ["2026-10-05", "Joined", "Asha Test"], ["2026-10-15", "Left", "Gone Test"],
    ]);
  });

  it("works out monthly attrition from the average headcount", () => {
    const rows = run(hr, "attrition").rows;
    expect(rows).toHaveLength(12);
    expect(rows.at(-2)).toEqual({ month: "October 2026", opening: 3, joiners: 1, leavers: 1, closing: 3, attrition: 33.3 });
    expect(rows.at(-1)).toMatchObject({ month: "November 2026", opening: 3, leavers: 0, attrition: 0 });
  });

  it("masks bank and ID numbers in the employee master", () => {
    const row = run(hr, "employee-master").rows.find((r) => r.name === "Kiran Test")!;
    expect(row).toMatchObject({ manager: "Boss Test", department: "Sales", type: "Contract", bank: "HDFC", ifsc: "HDFC0000001" });
    expect(row.account).toMatch(/^X+9012$/);
    expect(row.pan).toMatch(/^X+234F$/);
    expect(JSON.stringify(run(hr, "employee-master").rows)).not.toContain("123456789012");
  });

  it("lists the month's birthdays and anniversaries of current staff", () => {
    expect(run(hr, "celebrations", { period: "2026-11" }).rows).toEqual([
      { date: "2026-11-12", name: "Boss Test", occasion: "Work anniversary", years: 6 },
      { date: "2026-11-20", name: "Boss Test", occasion: "Birthday", years: null },
    ]);
  });

  it("is for HR only", () => {
    expectDomainError(() => run(manager, "headcount"), "FORBIDDEN");
    expectDomainError(() => run(hr, "no-such-report"), "NOT_FOUND");
  });
});

describe("attendance reports", () => {
  beforeEach(() => {
    day(asha, "2026-11-02", "present", { firstIn: 570, lastOut: 1110, workedMinutes: 540, lateMinutes: 30 });
    day(asha, "2026-11-03", "half_leave", { firstIn: 840, lastOut: 1110, workedMinutes: 270, earlyMinutes: 0 });
    day(asha, "2026-11-04", "absent");
    day(asha, "2026-11-07", "weekly_off", { firstIn: 600, lastOut: 900, workedMinutes: 300, offDayWorked: true });
    day(asha, "2026-11-10", "present", { firstIn: 540, workedMinutes: 0 });
    day(kiran, "2026-11-02", "present", { firstIn: 540, lastOut: 1200, workedMinutes: 660, overtimeMinutes: 120, earlyMinutes: 0 });
    day(kiran, "2026-11-03", "half_day", { firstIn: 540, lastOut: 840, workedMinutes: 300, earlyMinutes: 240 });
    day(kiran, "2026-11-04", "on_leave");
    day(boss, "2026-11-02", "present", { firstIn: 540, lastOut: 1080, workedMinutes: 540 });
    clockIn(asha, "2026-11-02T04:00:00.000Z", "remote");
    clockIn(asha, "2026-11-02T08:00:00.000Z", "office");
    clockIn(asha, "2026-11-03T08:30:00.000Z", "office");
    clockIn(kiran, "2026-11-02T03:30:00.000Z", "remote");
    clockIn(kiran, "2026-11-03T03:30:00.000Z", "remote");
  });

  it("builds the muster roll with day codes and totals, without today's provisional status", () => {
    const result = run(hr, "muster-roll", { period: "2026-11", department: String(eng) });
    expect(result.rows.map((r) => r.name)).toEqual(["Boss Test", "Asha Test"]);
    const ashaRow = result.rows[1]!;
    expect([ashaRow["2026-11-02"], ashaRow["2026-11-03"], ashaRow["2026-11-04"], ashaRow["2026-11-07"], ashaRow["2026-11-10"]]).toEqual(["P", "HL", "A", "WO", null]);
    expect(ashaRow).toMatchObject({ present: 1.5, absent: 1, leave: 0.5 });
    expect(result.columns).toHaveLength(2 + 30 + 3);
    expect(run(payroll, "muster-roll", { period: "2026-11" }).rows).toHaveLength(3);
  });

  it("shows one day's status, times and first work mode", () => {
    const rows = run(hr, "daily-status", { date: "2026-11-02" }).rows;
    expect(rows.find((r) => r.name === "Asha Test")).toMatchObject({ status: "Present", in: "09:30", out: "18:30", worked: 540, late: 30, mode: "Remote" });
    expect(rows.find((r) => r.name === "Gone Test")).toBeUndefined();
    expect(run(hr, "daily-status", { date: "2026-11-10" }).note).toMatch(/still changing/);
  });

  it("totals late arrivals, early exits and overtime", () => {
    const late = run(hr, "late-early", { from: "2026-11-01", to: "2026-11-09" }).rows;
    expect(late.find((r) => r.name === "Asha Test")).toMatchObject({ lateDays: 1, lateMinutes: 30, earlyDays: 0 });
    expect(late.find((r) => r.name === "Kiran Test")).toMatchObject({ lateDays: 0, earlyDays: 1, earlyMinutes: 240 });
    expect(run(hr, "overtime", { from: "2026-11-01", to: "2026-11-09" }).rows.find((r) => r.name === "Kiran Test")).toMatchObject({ days: 1, overtime: 120 });
  });

  it("splits office and remote days by the first clock-in", () => {
    const rows = run(hr, "remote-office", { from: "2026-11-01", to: "2026-11-09" }).rows;
    expect(rows.find((r) => r.name === "Asha Test")).toMatchObject({ office: 1, remote: 1, remoteShare: 50 });
    expect(rows.find((r) => r.name === "Kiran Test")).toMatchObject({ office: 0, remote: 2, remoteShare: 100 });
    expect(rows.find((r) => r.name === "Boss Test")).toMatchObject({ office: 0, remote: 0, remoteShare: null });
  });

  it("lists work on off days with the comp-off claim", () => {
    db.insert(compOffClaims).values({ employeeId: asha.id, workedDate: "2026-11-07", workedMinutes: 300, daysRequested: 0.5, status: "approved", resolution: "payout" }).run();
    expect(run(hr, "off-day-work", { from: "2026-11-01", to: "2026-11-09" }).rows).toEqual([
      { date: "2026-11-07", code: asha.employeeCode, name: "Asha Test", department: "Engineering", worked: 300, claim: "Approved (paid out)" },
    ]);
  });

  it("limits a manager to their reporting tree", () => {
    expect(run(manager, "muster-roll", { period: "2026-11" }).rows.map((r) => r.name)).toEqual(["Asha Test", "Kiran Test"]);
    expect(runReport(db, manager, "daily-status", { employee: String(gone.id) }, NOW).params.employeeId).toBeNull();
  });
});
