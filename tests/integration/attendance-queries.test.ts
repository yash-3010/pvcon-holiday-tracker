import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { attendancePunches, type EmployeeRow } from "@/server/db/schema";
import { recomputeAttendance } from "@/server/modules/attendance/compute";
import { clockIn } from "@/server/modules/attendance/punches";
import { employeeAttendanceSummary, musterRoll, myAttendanceMonth, pendingRegularizationsFor, todayBoard } from "@/server/modules/attendance/queries";
import { requestRegularization } from "@/server/modules/attendance/regularization";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { myCompOff, pendingCompOffClaimsFor } from "@/server/modules/compoff/queries";
import { approveCompOffClaim, submitCompOffClaim } from "@/server/modules/compoff/service";
import { createHoliday } from "@/server/modules/holidays/service";
import { syncEntitlements } from "@/server/modules/leave/ledger";
import { applyLeaveOnBehalf } from "@/server/modules/leave/requests";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertDepartment, insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

// Tuesday 10 Nov 2026, 11:30 IST.
const NOW = new Date("2026-11-10T06:00:00Z");
const TODAY = "2026-11-10";
let db: DB;
type Person = { employee: EmployeeRow; user: SessionUser };
let hr: Person, ravi: Person, asha: Person, kiran: Person, meera: Person;

function person(name: string, overrides: Partial<EmployeeRow> = {}, roles: ("employee" | "hr_admin")[] = ["employee"]): Person {
  const login = insertUser(db, { roles, name });
  const employee = insertEmployee(db, { firstName: name, lastName: "Test", dateOfJoining: "2025-01-01", userId: login.id, ...overrides });
  syncEntitlements(db, employee.id, TODAY);
  return { employee, user: sessionUserFor(db, login) };
}
function worked(employeeId: number, date: string, inUtc: string, outUtc: string) {
  db.insert(attendancePunches).values({ employeeId, at: `${date}T${inUtc}:00.000Z`, date, direction: "in" }).run();
  db.insert(attendancePunches).values({ employeeId, at: `${date}T${outUtc}:00.000Z`, date, direction: "out" }).run();
  recomputeAttendance(db, employeeId, date, date, { now: NOW });
}

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  seedDefaultLeaveTypes(db);
  const engineering = insertDepartment(db, "Engineering");
  hr = person("Hema", {}, ["employee", "hr_admin"]);
  ravi = person("Ravi", { departmentId: engineering.id });
  asha = person("Asha", { reportingManagerId: ravi.employee.id, departmentId: engineering.id });
  kiran = person("Kiran", { reportingManagerId: ravi.employee.id });
  meera = person("Meera");
  ravi = { ...ravi, user: sessionUserFor(db, getUserById(db, ravi.user.id)!) };
});

describe("my attendance month", () => {
  it("lists every day with its status, punches and what can be done", () => {
    createHoliday(db, { date: "2026-11-02", name: "Festival", type: "fixed" });
    worked(asha.employee.id, "2026-11-03", "04:00", "13:00");
    worked(asha.employee.id, "2026-11-07", "04:30", "13:00");
    recomputeAttendance(db, asha.employee.id, "2026-11-01", "2026-11-09", { now: NOW });
    clockIn(db, asha.employee.id, { workMode: "remote", ip: null, now: new Date("2026-11-10T04:00:00Z") });
    const month = myAttendanceMonth(db, asha.employee.id, "2026-11", NOW);
    expect(month.days).toHaveLength(30);
    const byDate = Object.fromEntries(month.days.map((d) => [d.date, d]));
    expect(byDate["2026-11-02"]).toMatchObject({ status: "holiday", holiday: "Festival" });
    expect(byDate["2026-11-03"]).toMatchObject({ status: "present", workedMinutes: 540, canRegularize: true });
    expect(byDate["2026-11-03"]!.punches.map((p) => [p.time, p.direction])).toEqual([["09:30", "in"], ["18:30", "out"]]);
    expect(byDate["2026-11-04"]).toMatchObject({ status: "absent", canRegularize: true });
    expect(byDate["2026-11-07"]).toMatchObject({ status: "weekly_off", offDayWorked: true, compOff: { eligibleDays: 1, claim: null } });
    expect(byDate["2026-11-10"]).toMatchObject({ isToday: true, workedMinutes: 120, canRegularize: false });
    expect(byDate["2026-11-11"]).toMatchObject({ isFuture: true, status: null, canRegularize: false });
    expect(month.summary).toMatchObject({ present: 1, absent: 4, holiday: 1, weekly_off: 3 });
  });
});

describe("team views", () => {
  it("shows managers their team and HR everyone, today and over a month", () => {
    clockIn(db, asha.employee.id, { workMode: "office", ip: null, now: new Date("2026-11-10T04:30:00Z") });
    clockIn(db, kiran.employee.id, { workMode: "remote", ip: null, now: new Date("2026-11-10T03:55:00Z") });
    applyLeaveOnBehalf(
      db, hr.user,
      { employeeId: meera.employee.id, leaveTypeId: listLeaveTypes(db)[0]!.id, startDate: TODAY, endDate: TODAY, startHalf: "full", endHalf: "full", reason: null },
      { today: TODAY, attachmentFileId: null },
    );
    const forRavi = todayBoard(db, ravi.user, NOW);
    expect(forRavi.rows.map((r) => [r.name, r.state, r.workMode, r.late])).toEqual([
      ["Asha Test", "in", "office", true],
      ["Kiran Test", "in", "remote", false],
    ]);
    const forHr = todayBoard(db, hr.user, NOW);
    expect(forHr.totals).toMatchObject({ in: 2, remote: 1, late: 1, onLeave: 1, notIn: 2 });
    expect(todayBoard(db, meera.user, NOW).rows).toEqual([]);

    recomputeAttendance(db, asha.employee.id, "2026-11-02", "2026-11-03", { now: NOW });
    const muster = musterRoll(db, ravi.user, "2026-11", {}, NOW);
    expect(muster.rows.map((r) => r.employee.name)).toEqual(["Asha Test", "Kiran Test"]);
    expect(muster.rows[0]!.cells["2026-11-02"]).toMatchObject({ code: "A", status: "absent" });
    expect(muster.rows[0]!.totals.absent).toBe(2);
    expect(musterRoll(db, hr.user, "2026-11", { departmentId: asha.employee.departmentId! }, NOW).rows.map((r) => r.employee.name)).toEqual([
      "Ravi Test", "Asha Test",
    ]);
  });

  it("queues regularizations and comp-off claims for the right approver", () => {
    worked(asha.employee.id, "2026-11-07", "04:30", "13:00");
    requestRegularization(db, asha.user, { date: "2026-11-09", requestedIn: 570, requestedOut: 1110, reason: "Forgot" }, { today: TODAY });
    const claim = submitCompOffClaim(db, asha.user, { workedDate: "2026-11-07", reason: null }, { today: TODAY });
    expect(pendingRegularizationsFor(db, ravi.user).map((r) => [r.employeeName, r.date, r.actual?.status ?? null])).toEqual([
      ["Asha Test", "2026-11-09", null],
    ]);
    expect(pendingRegularizationsFor(db, meera.user)).toEqual([]);
    expect(pendingCompOffClaimsFor(db, ravi.user).map((c) => [c.employeeName, c.workedDate, c.daysRequested])).toEqual([["Asha Test", "2026-11-07", 1]]);
    expect(pendingCompOffClaimsFor(db, hr.user)).toHaveLength(1);
    approveCompOffClaim(db, ravi.user, claim.id, { resolution: "leave", note: null, today: TODAY });
    expect(myCompOff(db, asha.employee.id, TODAY)).toMatchObject({
      available: 1, nextExpiry: { date: "2027-02-05", days: 1 }, lots: [{ remaining: 1, status: "active" }], claims: [{ status: "approved" }],
    });
  });

  it("summarises a month for the profile", () => {
    worked(asha.employee.id, "2026-11-03", "04:00", "13:00");
    const summary = employeeAttendanceSummary(db, asha.employee.id, "2026-11", NOW);
    expect(summary).toMatchObject({ shift: { name: "General" }, counts: { present: 1 } });
  });
});
