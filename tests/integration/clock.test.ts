import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { attendanceDays, clockSelections, runningTimers, taskCategories, timesheetEntries, timesheets, type EmployeeRow, type ProjectRow, type TaskCategoryRow } from "@/server/db/schema";
import { clockState } from "@/server/modules/attendance/punches";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { clockSnapshot } from "@/server/modules/clock/queries";
import { defaultSelection, endForgottenTimers, endWork, resumeWork, startWork, switchTask, takeBreak } from "@/server/modules/clock/service";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { listCategories } from "@/server/modules/projects/queries";
import { addMembers, createClient, createProject, seedTimesheetDefaults } from "@/server/modules/projects/service";
import { allowedProjects, saveWeek } from "@/server/modules/timesheets/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

let db: DB;
let asha: { employee: EmployeeRow; user: SessionUser };
let internal: ProjectRow, portal: ProjectRow;
let dev: TaskCategoryRow, training: TaskCategoryRow;
// Wednesday 21 October 2026; 04:00Z is 09:30 in Pune.
const at = (hhmm: string, date = "2026-10-21") => ({ now: new Date(`${date}T${hhmm}:00Z`), ip: null });
const cells = () =>
  db.select().from(timesheetEntries).all().map((e) => [e.projectId === portal.id ? "portal" : "internal", e.taskCategoryId === dev.id ? "dev" : "training", e.date, e.minutes]);

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  seedDefaultLeaveTypes(db);
  seedTimesheetDefaults(db);
  const login = insertUser(db);
  asha = { employee: insertEmployee(db, { dateOfJoining: "2025-01-01", userId: login.id }), user: sessionUserFor(db, login) };
  internal = allowedProjects(db, asha.employee.id, "2026-10-21")[0]!;
  const acme = createClient(db, { name: "Acme Retail", code: "ACME" });
  portal = createProject(db, {
    name: "Acme portal", code: "ACME-PORTAL", clientId: acme.id, billableDefault: true, status: "active", startDate: null, endDate: null,
    budgetHours: null, managerEmployeeId: null,
  });
  addMembers(db, portal.id, [asha.employee.id], null);
  [dev, training] = [listCategories(db, {})[0]!, listCategories(db, {}).find((c) => c.name === "Training")!];
});

describe("work clock", () => {
  it("logs the day to the timesheet: clock in, a break, resume, clock out", () => {
    const started = startWork(db, asha.user, { workMode: "office", selection: { projectId: portal.id, taskCategoryId: dev.id, notes: null } }, at("04:00"));
    expect(started).toMatchObject({ time: "09:30", logging: { projectId: portal.id, taskCategoryId: dev.id }, notices: [] });
    expect(clockSnapshot(db, asha.employee.id, new Date("2026-10-21T05:00:00Z"))).toMatchObject({
      state: "working", workMode: "office", workedSeconds: 3600, logging: { label: "ACME-PORTAL · Acme portal · Development" },
    });

    expect(takeBreak(db, asha.user, at("07:30"))).toMatchObject({ time: "13:00", added: { minutes: 210, date: "2026-10-21" }, logging: null });
    expect(clockSnapshot(db, asha.employee.id, new Date("2026-10-21T08:00:00Z"))).toMatchObject({ state: "break", breakSeconds: 1800, logging: null });

    // Resume carries on with the same task and work mode.
    expect(resumeWork(db, asha.user, at("08:15"))).toMatchObject({ logging: { projectId: portal.id, taskCategoryId: dev.id } });
    expect(endWork(db, asha.user, at("13:15"))).toMatchObject({ time: "18:45", added: { minutes: 300 } });
    expect(cells()).toEqual([["portal", "dev", "2026-10-21", 510]]);
    expect(db.select().from(attendanceDays).get()).toMatchObject({ status: "present", workedMinutes: 510 });
    expect(clockSnapshot(db, asha.employee.id, new Date("2026-10-21T14:00:00Z"))).toMatchObject({ state: "done", workedSeconds: 510 * 60, breakSeconds: 45 * 60 });
  });

  it("splits the day between tasks when switching, and remembers the last one", () => {
    startWork(db, asha.user, { workMode: "remote", selection: { projectId: portal.id, taskCategoryId: dev.id, notes: null } }, at("04:00"));
    expect(switchTask(db, asha.user, { projectId: internal.id, taskCategoryId: training.id, notes: "Security course" }, at("06:00"))).toMatchObject({
      added: { minutes: 120 }, logging: { projectId: internal.id, taskCategoryId: training.id },
    });
    endWork(db, asha.user, at("08:00"));
    expect(cells()).toEqual([["portal", "dev", "2026-10-21", 120], ["internal", "training", "2026-10-21", 120]]);
    expect(db.select().from(clockSelections).get()).toMatchObject({ projectId: internal.id, taskCategoryId: training.id, notes: "Security course" });
    // The next morning starts where the last day ended, in the same work mode.
    expect(clockSnapshot(db, asha.employee.id, new Date("2026-10-22T03:00:00Z"))).toMatchObject({
      state: "idle", workMode: "remote", selection: { projectId: internal.id, taskCategoryId: training.id, label: "INT · Internal · Training" },
    });
  });

  it("switching while not working only sets what the clock logs next", () => {
    expect(switchTask(db, asha.user, { projectId: internal.id, taskCategoryId: training.id, notes: null }, at("03:00"))).toMatchObject({ logging: null, added: null });
    expect(startWork(db, asha.user, { workMode: "office", selection: null }, at("04:00")).logging).toMatchObject({ projectId: internal.id, taskCategoryId: training.id });
    expectDomainError(() => switchTask(db, asha.user, { projectId: 9999, taskCategoryId: dev.id, notes: null }, at("05:00")), "PROJECT_NOT_ALLOWED");
  });

  it("keeps the clock running when the timesheet can't take time, and says why", () => {
    saveWeek(db, asha.user, { weekStart: "2026-10-19", rows: [] }, { today: "2026-10-21" });
    db.update(timesheets).set({ status: "submitted" }).run();
    const started = startWork(db, asha.user, { workMode: "office", selection: null }, at("04:00"));
    expect(started.logging).toBeNull();
    expect(started.notices[0]).toMatch(/^Time isn't going to your timesheet: This week has been submitted/);
    expect(clockState(db, asha.employee.id, new Date("2026-10-21T05:00:00Z")).state).toBe("in");
    expect(clockSnapshot(db, asha.employee.id, new Date("2026-10-21T05:00:00Z")).blocked).toBe("This week's timesheet is submitted, so the clock can't add time to it.");
    expect(endWork(db, asha.user, at("06:00")).notices).toEqual([]);
  });

  it("drops a piece the timesheet won't take any more, with a notice, and still clocks out", () => {
    saveWeek(db, asha.user, { weekStart: "2026-10-19", rows: [] }, { today: "2026-10-21" });
    startWork(db, asha.user, { workMode: "office", selection: null }, at("04:00"));
    db.update(timesheets).set({ status: "submitted" }).run();
    const ended = endWork(db, asha.user, at("06:00"));
    expect(ended.notices[0]).toMatch(/^2h 00m couldn't go to your timesheet: This week has been submitted/);
    expect(db.select().from(runningTimers).all()).toEqual([]);
    expect(clockState(db, asha.employee.id, new Date("2026-10-21T07:00:00Z")).state).toBe("out");
  });

  it("ends the day at the break when clocking out from one", () => {
    startWork(db, asha.user, { workMode: "office", selection: null }, at("04:00"));
    takeBreak(db, asha.user, at("07:30"));
    expect(endWork(db, asha.user, at("09:00"))).toMatchObject({ time: "13:00", added: null });
    expect(clockSnapshot(db, asha.employee.id, new Date("2026-10-21T10:00:00Z"))).toMatchObject({
      state: "done", workedSeconds: 210 * 60, breakSeconds: 0, endedAt: "2026-10-21T07:30:00.000Z",
    });
    expectDomainError(() => resumeWork(db, asha.user, at("10:00")), "NOT_ON_BREAK");
  });

  it("stops a forgotten timer at the shift's end, at night or at the next clock-in", () => {
    startWork(db, asha.user, { workMode: "office", selection: null }, at("04:00"));
    // Nobody clocked out: the nightly close stops the timer at 18:30, the shift's end (9 h).
    expect(endForgottenTimers(db, "2026-10-21")).toBe(1);
    expect(cells()).toEqual([["portal", "dev", "2026-10-21", 540]]);

    startWork(db, asha.user, { workMode: "office", selection: null }, at("04:00", "2026-10-22"));
    // If the nightly run hasn't happened yet, the next clock-in does the same.
    startWork(db, asha.user, { workMode: "office", selection: null }, at("04:00", "2026-10-23"));
    expect(cells()).toContainEqual(["portal", "dev", "2026-10-22", 540]);
    expect(db.select().from(runningTimers).get()).toMatchObject({ startedAt: "2026-10-23T04:00:00.000Z" });
  });

  it("defaults to the last choice, then the latest week's biggest row, then the first project", () => {
    expect(defaultSelection(db, asha.employee.id, "2026-10-21")).toEqual({ projectId: portal.id, taskCategoryId: dev.id, notes: null });
    saveWeek(db, asha.user, {
      weekStart: "2026-10-19",
      rows: [
        { projectId: portal.id, taskCategoryId: dev.id, billable: true, notes: "", minutes: { "2026-10-19": 60 } },
        { projectId: internal.id, taskCategoryId: training.id, billable: false, notes: "", minutes: { "2026-10-19": 120, "2026-10-20": 60 } },
      ],
    }, { today: "2026-10-21" });
    expect(defaultSelection(db, asha.employee.id, "2026-10-21")).toEqual({ projectId: internal.id, taskCategoryId: training.id, notes: null });
    switchTask(db, asha.user, { projectId: portal.id, taskCategoryId: training.id, notes: "Reviews" }, at("03:00"));
    expect(defaultSelection(db, asha.employee.id, "2026-10-21")).toEqual({ projectId: portal.id, taskCategoryId: training.id, notes: "Reviews" });
    // A choice that's no longer open (an archived task) falls back.
    db.update(taskCategories).set({ archived: true }).where(eq(taskCategories.id, training.id)).run();
    expect(defaultSelection(db, asha.employee.id, "2026-10-21")).toEqual({ projectId: portal.id, taskCategoryId: dev.id, notes: null });
  });
});
