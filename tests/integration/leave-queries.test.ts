import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { files, type EmployeeRow, type LeaveTypeRow } from "@/server/db/schema";
import { canAccessFile } from "@/server/modules/files/access";
import { createHoliday, selectOptionalHoliday, setYearConfig } from "@/server/modules/holidays/service";
import { postLedger, syncEntitlements } from "@/server/modules/leave/ledger";
import {
  balanceSheet, employeeLeaveSummary, employeeLedger, listLeaveRequests, myLeaveRequests, pendingLeaveForApprover, teamCalendar,
} from "@/server/modules/leave/queries";
import { applyLeave, approveLeave } from "@/server/modules/leave/requests";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertDepartment, insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const TODAY = "2026-10-20";
let db: DB;
let types: Record<string, LeaveTypeRow>;
type Person = { employee: EmployeeRow; user: SessionUser };
let hr: Person, ravi: Person, asha: Person, kiran: Person, meera: Person;

function person(name: string, overrides: Partial<EmployeeRow> = {}, roles: ("employee" | "hr_admin")[] = ["employee"]): Person {
  const login = insertUser(db, { roles, name });
  const employee = insertEmployee(db, { firstName: name, lastName: "Test", dateOfJoining: "2025-01-01", userId: login.id, ...overrides });
  syncEntitlements(db, employee.id, TODAY);
  return { employee, user: sessionUserFor(db, login) };
}
const reload = (p: Person): Person => ({ ...p, user: sessionUserFor(db, getUserById(db, p.user.id)!) });
const range = (startDate: string, endDate = startDate) => ({
  leaveTypeId: types.CL.id, startDate, endDate, startHalf: "full" as const, endHalf: "full" as const, reason: null,
});
const apply = (p: Person, startDate: string, endDate = startDate, attachmentFileId: number | null = null) =>
  applyLeave(db, p.user, range(startDate, endDate), { today: TODAY, attachmentFileId });

beforeEach(() => {
  db = createTestDb();
  seedDefaultLeaveTypes(db);
  types = Object.fromEntries(listLeaveTypes(db).map((t) => [t.code, t]));
  const engineering = insertDepartment(db, "Engineering");
  hr = person("Hema", {}, ["employee", "hr_admin"]);
  ravi = person("Ravi", { departmentId: engineering.id });
  asha = person("Asha", { reportingManagerId: ravi.employee.id, departmentId: engineering.id });
  kiran = person("Kiran", { reportingManagerId: ravi.employee.id });
  meera = person("Meera");
  ravi = reload(ravi);
});

describe("approval queue", () => {
  it("shows managers their team, HR everyone else, and nobody their own requests", () => {
    const a = apply(asha, "2026-11-02");
    const k = apply(kiran, "2026-11-03");
    const m = apply(meera, "2026-11-04");
    const h = apply(hr, "2026-11-05");
    expect(pendingLeaveForApprover(db, ravi.user).map((r) => r.id)).toEqual([a.id, k.id]);
    expect(pendingLeaveForApprover(db, hr.user).map((r) => r.id)).toEqual([a.id, k.id, m.id]);
    expect(pendingLeaveForApprover(db, meera.user)).toEqual([]);
    expect(h.status).toBe("pending");
    expect(pendingLeaveForApprover(db, ravi.user)[0]).toMatchObject({
      employeeName: "Asha Test", leaveType: { code: "CL" }, days: 1, balance: 12, balanceAfter: 11,
    });
  });
});

describe("request register", () => {
  it("scopes and filters", () => {
    const a = apply(asha, "2026-11-02");
    approveLeave(db, ravi.user, a.id, null);
    const k = apply(kiran, "2026-11-10");
    apply(meera, "2026-11-04");
    expect(listLeaveRequests(db, ravi.user, {}).map((r) => r.id)).toEqual([k.id, a.id]);
    expect(listLeaveRequests(db, hr.user, {})).toHaveLength(3);
    expect(listLeaveRequests(db, hr.user, { status: "approved" }).map((r) => r.id)).toEqual([a.id]);
    expect(listLeaveRequests(db, hr.user, { from: "2026-11-05", to: "2026-11-30" }).map((r) => r.id)).toEqual([k.id]);
    expect(listLeaveRequests(db, hr.user, { employeeId: kiran.employee.id }).map((r) => r.id)).toEqual([k.id]);
    expect(listLeaveRequests(db, meera.user, {})).toEqual([]);
    expect(listLeaveRequests(db, hr.user, {})[2]).toMatchObject({ approverName: "Ravi", status: "approved" });
  });

  it("lists my requests for a leave year with what I can still do", () => {
    const pending = apply(asha, "2026-11-02");
    const approved = apply(asha, "2026-11-03");
    approveLeave(db, ravi.user, approved.id, null);
    const mine = myLeaveRequests(db, asha.employee.id, 2026, TODAY);
    expect(mine.map((r) => [r.id, r.canWithdraw, r.canCancel])).toEqual([
      [approved.id, false, true],
      [pending.id, true, false],
    ]);
    expect(myLeaveRequests(db, asha.employee.id, 2026, "2026-11-03").find((r) => r.id === approved.id)!.canCancel).toBe(false);
  });
});

describe("balances", () => {
  it("builds the employee × type sheet for a year", () => {
    const a = apply(asha, "2026-11-02", "2026-11-03");
    approveLeave(db, ravi.user, a.id, null);
    apply(asha, "2026-11-04");
    const sheet = balanceSheet(db, 2026, {});
    expect(sheet.types.map((t) => t.code)).toEqual(["CL", "SL", "LWP", "CO"]);
    const row = sheet.rows.find((r) => r.employee.id === asha.employee.id)!;
    expect(row.employee).toMatchObject({ name: "Asha Test", department: "Engineering" });
    expect(row.balances[types.CL.id]).toEqual({ balance: 10, used: 2, pending: 1 });
    expect(balanceSheet(db, 2026, { departmentId: asha.employee.departmentId! }).rows.map((r) => r.employee.name)).toEqual(["Ravi Test", "Asha Test"]);
  });

  it("shows an employee's ledger with who posted each entry", () => {
    postLedger(db, { employeeId: asha.employee.id, leaveTypeId: types.CL.id, year: 2026, date: TODAY, delta: -1, kind: "adjustment", note: "Fix", createdBy: hr.user.id });
    expect(employeeLedger(db, asha.employee.id, types.CL.id, 2026).map((r) => [r.kind, r.delta, r.createdByName])).toEqual([
      ["grant", 12, null],
      ["adjustment", -1, "Hema"],
    ]);
  });

  it("summarises an employee's leave for the profile", () => {
    apply(asha, "2026-11-02");
    const summary = employeeLeaveSummary(db, asha.employee.id, 2026);
    expect(summary.balances.find((b) => b.type.code === "CL")).toMatchObject({ balance: 12, pending: 1 });
    expect(summary.recent).toHaveLength(1);
  });
});

describe("team calendar", () => {
  it("shows the team with holidays, weekly offs and masked leave types for peers", () => {
    setYearConfig(db, 2026, 1);
    createHoliday(db, { date: "2026-11-09", name: "Diwali", type: "optional" });
    const diwali = createHoliday(db, { date: "2026-11-10", name: "Bhai Dooj", type: "optional" });
    createHoliday(db, { date: "2026-11-14", name: "Fixed", type: "fixed" });
    selectOptionalHoliday(db, kiran.employee.id, diwali.id, true, TODAY);
    const a = apply(asha, "2026-11-02", "2026-11-03");
    approveLeave(db, ravi.user, a.id, null);
    apply(kiran, "2026-11-05");

    const forKiran = teamCalendar(db, kiran.user, "2026-11", {});
    expect(forKiran.rows.map((r) => r.employee.name)).toEqual(["Asha Test", "Kiran Test"]);
    expect(forKiran.days).toHaveLength(30);
    expect(forKiran.days.find((d) => d.date === "2026-11-14")).toMatchObject({ holiday: "Fixed", weekday: 6 });
    const ashaRow = forKiran.rows[0]!;
    expect(ashaRow.cells["2026-11-02"]).toEqual({ kind: "leave", code: "Leave", name: "Leave", color: null, portion: "full", status: "approved" });
    const kiranRow = forKiran.rows[1]!;
    expect(kiranRow.cells["2026-11-05"]).toMatchObject({ kind: "leave", code: "CL", status: "pending" });
    expect(kiranRow.cells["2026-11-10"]).toMatchObject({ kind: "holiday", name: "Bhai Dooj" });
    expect(kiranRow.weeklyOffs).toEqual([0, 6]);

    const forRavi = teamCalendar(db, ravi.user, "2026-11", {});
    expect(forRavi.rows.map((r) => r.employee.name)).toEqual(["Ravi Test", "Asha Test", "Kiran Test"]);
    expect(forRavi.rows[1]!.cells["2026-11-03"]).toMatchObject({ code: "CL", color: types.CL.color });

    expect(teamCalendar(db, hr.user, "2026-11", { departmentId: asha.employee.departmentId! }).rows.map((r) => r.employee.name)).toEqual([
      "Ravi Test", "Asha Test",
    ]);
  });
});

describe("attachment access", () => {
  it("lets the employee, their manager and HR open a leave document, but not a peer", () => {
    const file = db.insert(files).values({ storageName: "s", originalName: "note.pdf", mime: "application/pdf", size: 1, sha256: "x", uploadedBy: asha.user.id }).returning().get();
    db.update(files).set({ uploadedBy: null }).where(eq(files.id, file.id)).run();
    apply(asha, "2026-11-02", "2026-11-02", file.id);
    const row = db.select().from(files).where(eq(files.id, file.id)).get()!;
    expect(canAccessFile(db, asha.user, row)).toBe(true);
    expect(canAccessFile(db, ravi.user, row)).toBe(true);
    expect(canAccessFile(db, hr.user, row)).toBe(true);
    expect(canAccessFile(db, kiran.user, row)).toBe(false);
  });
});
