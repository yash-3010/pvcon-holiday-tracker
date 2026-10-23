import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { runningTimers, timesheetEntries, timesheets, type EmployeeRow, type ProjectRow, type TaskCategoryRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { listCategories } from "@/server/modules/projects/queries";
import { seedTimesheetDefaults } from "@/server/modules/projects/service";
import { allowedProjects, saveWeek } from "@/server/modules/timesheets/service";
import { discardTimer, runningTimer, startTimer, stopTimer } from "@/server/modules/timesheets/timer";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

let db: DB;
let asha: { employee: EmployeeRow; user: SessionUser };
let internal: ProjectRow;
let dev: TaskCategoryRow, training: TaskCategoryRow;
// Wednesday 21 Oct 2026 in IST.
const at = (iso: string) => new Date(iso);
const start = (when: string, categoryId = dev.id) =>
  startTimer(db, asha.user, { projectId: internal.id, taskCategoryId: categoryId, notes: "Pairing" }, { now: at(when) });
const cells = () => db.select().from(timesheetEntries).all().map((e) => [e.date, e.minutes, e.notes]);

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  seedDefaultLeaveTypes(db);
  seedTimesheetDefaults(db);
  const login = insertUser(db);
  asha = { employee: insertEmployee(db, { dateOfJoining: "2025-01-01", userId: login.id }), user: sessionUserFor(db, login) };
  internal = allowedProjects(db, asha.employee.id, "2026-10-21")[0]!;
  [dev, training] = [listCategories(db, {})[0]!, listCategories(db, {}).find((c) => c.name === "Training")!];
});

describe("running timer", () => {
  it("adds the rounded time to the start day's entry", () => {
    start("2026-10-21T04:00:00Z"); // 09:30 IST
    expect(runningTimer(db, asha.employee.id)).toMatchObject({ projectId: internal.id, notes: "Pairing" });
    expect(stopTimer(db, asha.user, { now: at("2026-10-21T05:07:00Z") })).toEqual({ minutes: 60, date: "2026-10-21" });
    expect(cells()).toEqual([["2026-10-21", 60, "Pairing"]]);
    expect(runningTimer(db, asha.employee.id)).toBeUndefined();
    start("2026-10-21T06:00:00Z");
    stopTimer(db, asha.user, { now: at("2026-10-21T06:45:00Z") });
    expect(cells()).toEqual([["2026-10-21", 105, "Pairing"]]);
  });

  it("keeps a forgotten timer on its start date, ending at local midnight", () => {
    start("2026-10-21T18:00:00Z"); // 23:30 IST
    expect(stopTimer(db, asha.user, { now: at("2026-10-22T04:00:00Z") })).toEqual({ minutes: 30, date: "2026-10-21" });
    expect(cells()).toEqual([["2026-10-21", 30, "Pairing"]]);
  });

  it("uses the category's billable default for a new row and adds nothing for a few minutes", () => {
    start("2026-10-21T04:00:00Z", training.id);
    expect(stopTimer(db, asha.user, { now: at("2026-10-21T04:05:00Z") })).toEqual({ minutes: 0, date: "2026-10-21" });
    expect(cells()).toEqual([]);
    start("2026-10-21T04:00:00Z", training.id);
    stopTimer(db, asha.user, { now: at("2026-10-21T05:00:00Z") });
    expect(db.select().from(timesheetEntries).get()!.billable).toBe(false);
  });

  it("allows one timer at a time and refuses to stop into a submitted week", () => {
    start("2026-10-21T04:00:00Z");
    expectDomainError(() => start("2026-10-21T04:10:00Z"), "TIMER_RUNNING");
    saveWeek(db, asha.user, { weekStart: "2026-10-19", rows: [] }, { today: "2026-10-21" });
    db.update(timesheets).set({ status: "submitted" }).run();
    expectDomainError(() => stopTimer(db, asha.user, { now: at("2026-10-21T05:00:00Z") }), "TIMESHEET_LOCKED");
    discardTimer(db, asha.user);
    expect(db.select().from(runningTimers).where(eq(runningTimers.employeeId, asha.employee.id)).all()).toEqual([]);
    expectDomainError(() => discardTimer(db, asha.user), "NO_TIMER");
    expectDomainError(() => start("2026-10-21T06:00:00Z"), "TIMESHEET_LOCKED");
  });
});
