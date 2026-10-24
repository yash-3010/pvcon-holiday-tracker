import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { leaveRequests, notifications, runningTimers, timesheets, type EmployeeRow, type ProjectRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { listCategories } from "@/server/modules/projects/queries";
import { seedTimesheetDefaults } from "@/server/modules/projects/service";
import {
  allowedProjects, approveTimesheet, bulkApproveTimesheets, rejectTimesheet, saveWeek, submitTimesheet, withdrawTimesheet,
} from "@/server/modules/timesheets/service";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

// Wednesday 28 Oct 2026; last week started on Monday the 19th.
const TODAY = "2026-10-28";
const NOW = new Date("2026-10-28T06:00:00Z");
const WEEK = "2026-10-19";
type Person = { employee: EmployeeRow; user: SessionUser };
let db: DB;
let ravi: Person, asha: Person, meera: Person, hr: Person;
let internal: ProjectRow;

function person(name: string, overrides: Partial<EmployeeRow> = {}, roles: ("employee" | "hr_admin")[] = ["employee"]): Person {
  const login = insertUser(db, { roles, name });
  return { employee: insertEmployee(db, { firstName: name, dateOfJoining: "2025-01-01", userId: login.id, ...overrides }), user: sessionUserFor(db, login) };
}
const logged = (p: Person, weekStart = WEEK, minutes = 480) =>
  saveWeek(
    db, p.user,
    { weekStart, rows: [{ projectId: internal.id, taskCategoryId: listCategories(db, {})[0]!.id, billable: false, notes: "", minutes: { [weekStart]: minutes } }] },
    { today: TODAY },
  ).timesheet;
const submit = (p: Person, weekStart = WEEK) => submitTimesheet(db, p.user, weekStart, { today: TODAY, now: NOW });
const status = (id: number) => db.select().from(timesheets).where(eq(timesheets.id, id)).get()!.status;

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  seedDefaultLeaveTypes(db);
  seedTimesheetDefaults(db);
  ravi = person("Ravi");
  asha = person("Asha", { reportingManagerId: ravi.employee.id });
  meera = person("Meera");
  hr = person("Hema", {}, ["employee", "hr_admin"]);
  ravi = { ...ravi, user: sessionUserFor(db, getUserById(db, ravi.user.id)!) };
  internal = allowedProjects(db, asha.employee.id, TODAY)[0]!;
});

describe("submitting", () => {
  it("submits, notifies the manager, and can be withdrawn and resubmitted", () => {
    const sheet = logged(asha);
    expect(submit(asha)).toMatchObject({ id: sheet.id, status: "submitted" });
    expect(db.select().from(notifications).where(eq(notifications.userId, ravi.user.id)).get()).toMatchObject({
      type: "timesheet.submitted", link: "/approvals?tab=timesheets",
    });
    expect(withdrawTimesheet(db, asha.user, sheet.id).status).toBe("draft");
    expect(submit(asha).status).toBe("submitted");
    expectDomainError(() => submit(asha), "NOT_EDITABLE");
  });

  it("refuses future weeks, empty working weeks and a running timer inside the week", () => {
    expectDomainError(() => submit(asha, "2026-11-02"), "FUTURE_WEEK");
    expectDomainError(() => submit(asha), "EMPTY_WEEK");
    logged(asha);
    db.insert(runningTimers).values({
      employeeId: asha.employee.id, projectId: internal.id, taskCategoryId: listCategories(db, {})[0]!.id, startedAt: "2026-10-21T04:00:00.000Z",
    }).run();
    expectDomainError(() => submit(asha), "TIMER_RUNNING");
  });

  it("lets a week spent entirely on leave go in empty", () => {
    const cl = listLeaveTypes(db).find((t) => t.code === "CL")!;
    db.insert(leaveRequests).values({
      employeeId: asha.employee.id, leaveTypeId: cl.id, startDate: "2026-10-19", endDate: "2026-10-23", startHalf: "full", endHalf: "full",
      days: 5, status: "approved",
    }).run();
    expect(submit(asha).status).toBe("submitted");
  });
});

describe("deciding", () => {
  it("lets the manager approve, which locks the week, and notifies the employee", () => {
    const sheet = logged(asha);
    submit(asha);
    expect(approveTimesheet(db, ravi.user, sheet.id, null)).toMatchObject({ status: "approved", approverId: ravi.user.id });
    expect(db.select().from(notifications).where(eq(notifications.userId, asha.user.id)).get()).toMatchObject({
      type: "timesheet.approved", link: `/me/timesheets/${WEEK}`,
    });
    expectDomainError(() => logged(asha), "TIMESHEET_LOCKED");
    expectDomainError(() => approveTimesheet(db, ravi.user, sheet.id, null), "NOT_PENDING");
  });

  it("returns a rejected week to the employee to fix", () => {
    const sheet = logged(asha);
    submit(asha);
    expect(rejectTimesheet(db, ravi.user, sheet.id, "Split the meetings out")).toMatchObject({ status: "rejected", decisionNote: "Split the meetings out" });
    expect(logged(asha, WEEK, 420).status).toBe("rejected");
    expect(submit(asha)).toMatchObject({ status: "submitted", decisionNote: null, approverId: null });
  });

  it("refuses peers and one's own week; HR decides org-wide", () => {
    const sheet = logged(asha);
    submit(asha);
    expectDomainError(() => approveTimesheet(db, meera.user, sheet.id, null), "FORBIDDEN");
    const own = logged(hr);
    submit(hr);
    expectDomainError(() => approveTimesheet(db, hr.user, own.id, null), "SELF_APPROVAL");
    expect(approveTimesheet(db, hr.user, sheet.id, null).status).toBe("approved");
  });

  it("bulk-approves and reports what it could not approve", () => {
    const a = logged(asha);
    submit(asha);
    const m = logged(meera);
    submit(meera);
    expect(bulkApproveTimesheets(db, ravi.user, [a.id, m.id], null)).toEqual({
      approved: [a.id], failed: [{ id: m.id, error: "You can only decide timesheets of people who report to you." }],
    });
    expect([status(a.id), status(m.id)]).toEqual(["approved", "submitted"]);
  });
});
