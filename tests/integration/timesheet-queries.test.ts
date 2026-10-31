import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { attendancePunches, type EmployeeRow, type ProjectRow } from "@/server/db/schema";
import { recomputeAttendance } from "@/server/modules/attendance/compute";
import { createShift, seedDefaultShift } from "@/server/modules/attendance/shifts";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { listCategories } from "@/server/modules/projects/queries";
import { seedTimesheetDefaults } from "@/server/modules/projects/service";
import {
  employeeTimesheetSummary, myWeeks, pendingTimesheetsFor, timesheetDetailForApprover, weekCard, weekDetail,
} from "@/server/modules/timesheets/queries";
import { allowedProjects, saveWeek, submitTimesheet } from "@/server/modules/timesheets/service";
import { startTimer } from "@/server/modules/timesheets/timer";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

// Wednesday 28 Oct 2026, 11:30 IST. Last week ran from Monday the 19th.
const TODAY = "2026-10-28";
const NOW = new Date("2026-10-28T06:00:00Z");
const LAST = "2026-10-19";
const THIS = "2026-10-26";
type Person = { employee: EmployeeRow; user: SessionUser };
let db: DB;
let ravi: Person, asha: Person, meera: Person;
let internal: ProjectRow;

function person(name: string, overrides: Partial<EmployeeRow> = {}): Person {
  const login = insertUser(db, { name });
  return { employee: insertEmployee(db, { firstName: name, dateOfJoining: "2025-01-01", userId: login.id, ...overrides }), user: sessionUserFor(db, login) };
}
function log(p: Person, weekStart: string, minutes: Record<string, number>, categoryIndex = 0, billable = true) {
  return saveWeek(
    db, p.user,
    { weekStart, rows: [{ projectId: internal.id, taskCategoryId: listCategories(db, {})[categoryIndex]!.id, billable, notes: "Build", minutes }] },
    { today: TODAY },
  ).timesheet;
}
function worked(p: Person, date: string, inUtc: string, outUtc: string) {
  db.insert(attendancePunches).values([
    { employeeId: p.employee.id, at: `${date}T${inUtc}:00.000Z`, date, direction: "in" },
    { employeeId: p.employee.id, at: `${date}T${outUtc}:00.000Z`, date, direction: "out" },
  ]).run();
  recomputeAttendance(db, p.employee.id, date, date, { now: NOW });
}

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  seedDefaultLeaveTypes(db);
  seedTimesheetDefaults(db);
  ravi = person("Ravi");
  asha = person("Asha", { reportingManagerId: ravi.employee.id });
  meera = person("Meera");
  ravi = { ...ravi, user: sessionUserFor(db, getUserById(db, ravi.user.id)!) };
  internal = allowedProjects(db, asha.employee.id, TODAY)[0]!;
});

describe("my weeks", () => {
  it("lists recent weeks newest first, with unsaved weeks as empty drafts", () => {
    log(asha, LAST, { "2026-10-19": 480, "2026-10-20": 240 });
    const weeks = myWeeks(db, asha.employee.id, { today: TODAY, count: 3 });
    expect(weeks.map((w) => [w.weekStart, w.status, w.loggedMinutes, w.availableMinutes, w.timesheetId === null])).toEqual([
      [THIS, "draft", 0, 2400, true],
      [LAST, "draft", 720, 2400, false],
      ["2026-10-12", "draft", 0, 2400, true],
    ]);
    expect(employeeTimesheetSummary(db, asha.employee.id, { today: TODAY })).toHaveLength(8);
    expect(weekCard(db, asha.employee.id, { today: TODAY })).toMatchObject({ weekStart: THIS, status: "draft", loggedMinutes: 0, availableMinutes: 2400 });
  });
});

describe("week detail", () => {
  it("groups entries into rows and compares each day with attendance", () => {
    log(asha, LAST, { "2026-10-19": 480, "2026-10-20": 480 });
    worked(asha, "2026-10-19", "04:00", "12:00"); // 8 h
    worked(asha, "2026-10-20", "04:00", "10:00"); // 6 h: 2 h short of what was logged
    const week = weekDetail(db, asha.employee.id, LAST, { today: TODAY, now: NOW });
    expect(week).toMatchObject({ status: "draft", editable: true, totals: { loggedMinutes: 960, billableMinutes: 960, availableMinutes: 2400 } });
    expect(week.rows).toEqual([
      expect.objectContaining({ projectCode: "INT", categoryName: "Development", billable: true, notes: "Build", minutes: { "2026-10-19": 480, "2026-10-20": 480 } }),
    ]);
    expect(week.days.slice(0, 3).map((d) => [d.date, d.loggedMinutes, d.workedMinutes, d.flag])).toEqual([
      ["2026-10-19", 480, 480, false],
      ["2026-10-20", 480, 360, true],
      ["2026-10-21", 0, null, false],
    ]);
    expect(week.options.projects.map((p) => p.code)).toEqual(["INT"]);
    expect(week.options.categories.length).toBeGreaterThan(5);
  });

  it("shows no attendance reference on an auto-mode shift, and today's timer on this week only", () => {
    const auto = createShift(db, {
      name: "Auto", startTime: "09:30", endTime: "18:30", breakMinutes: 60, graceMinutes: 15, halfDayMinutes: 240, fullDayMinutes: 480,
      weeklyOffs: [0, 6], attendanceMode: "auto", autoClockOutTime: null,
    });
    const kiran = person("Kiran", { shiftId: auto.id });
    recomputeAttendance(db, kiran.employee.id, "2026-10-19", "2026-10-23", { now: NOW });
    startTimer(db, kiran.user, { projectId: internal.id, taskCategoryId: listCategories(db, {})[0]!.id, notes: null }, { now: NOW });
    expect(weekDetail(db, kiran.employee.id, LAST, { today: TODAY, now: NOW }).days.every((d) => d.workedMinutes === null)).toBe(true);
    expect(weekDetail(db, kiran.employee.id, THIS, { today: TODAY, now: NOW }).timer).toMatchObject({ projectCode: "INT", startedAt: NOW.toISOString() });
    // Last week's page doesn't say the clock's time lands there.
    expect(weekDetail(db, kiran.employee.id, LAST, { today: TODAY, now: NOW }).timer).toBeNull();
  });
});

describe("approvals queue", () => {
  it("holds only the approver's team, and lets them open a week", () => {
    log(asha, LAST, { "2026-10-19": 480 });
    const ashaWeek = submitTimesheet(db, asha.user, LAST, { today: TODAY, now: NOW });
    log(meera, LAST, { "2026-10-19": 480 });
    const meeraWeek = submitTimesheet(db, meera.user, LAST, { today: TODAY, now: NOW });
    expect(pendingTimesheetsFor(db, ravi.user, { today: TODAY, now: NOW }).map((t) => [t.employeeName, t.weekStart, t.loggedMinutes, t.availableMinutes])).toEqual([
      ["Asha Test", LAST, 480, 2400],
    ]);
    expect(pendingTimesheetsFor(db, meera.user, { today: TODAY, now: NOW })).toEqual([]);
    expect(timesheetDetailForApprover(db, ravi.user, ashaWeek.id, { today: TODAY, now: NOW })).toMatchObject({ employeeName: "Asha Test", week: { status: "submitted" } });
    expect(timesheetDetailForApprover(db, ravi.user, meeraWeek.id, { today: TODAY, now: NOW })).toBeNull();
  });
});
