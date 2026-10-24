import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { leaveRequests, notifications, users, type EmployeeRow } from "@/server/db/schema";
import { runJobByName } from "@/server/jobs/registry";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { listCategories } from "@/server/modules/projects/queries";
import { seedTimesheetDefaults } from "@/server/modules/projects/service";
import { allowedProjects, saveWeek, submitTimesheet } from "@/server/modules/timesheets/service";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

// Friday 23 Oct 2026, 16:00 IST; and the Monday after, 10:00 IST.
const FRIDAY = new Date("2026-10-23T10:30:00Z");
const MONDAY = new Date("2026-10-26T04:30:00Z");
const WEEK = "2026-10-19";
type Person = { employee: EmployeeRow; user: SessionUser };
let db: DB;
let ravi: Person, asha: Person, kiran: Person, meera: Person;

function person(name: string, overrides: Partial<EmployeeRow> = {}): Person {
  const login = insertUser(db, { name });
  return { employee: insertEmployee(db, { firstName: name, dateOfJoining: "2025-01-01", userId: login.id, ...overrides }), user: sessionUserFor(db, login) };
}
const ofType = (type: string) => db.select().from(notifications).where(eq(notifications.type, type)).all();
function submitWeek(p: Person) {
  const internal = allowedProjects(db, p.employee.id, "2026-10-23")[0]!;
  saveWeek(
    db, p.user,
    { weekStart: WEEK, rows: [{ projectId: internal.id, taskCategoryId: listCategories(db, {})[0]!.id, billable: false, notes: "", minutes: { [WEEK]: 480 } }] },
    { today: "2026-10-23" },
  );
  submitTimesheet(db, p.user, WEEK, { today: "2026-10-23", now: FRIDAY });
}

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  seedDefaultLeaveTypes(db);
  seedTimesheetDefaults(db);
  ravi = person("Ravi");
  asha = person("Asha", { reportingManagerId: ravi.employee.id });
  kiran = person("Kiran", { reportingManagerId: ravi.employee.id });
  meera = person("Meera");
  ravi = { ...ravi, user: sessionUserFor(db, getUserById(db, ravi.user.id)!) };
});

describe("timesheet:remind-employees", () => {
  it("reminds people whose week is still open, once a week", () => {
    submitWeek(asha);
    const cl = listLeaveTypes(db).find((t) => t.code === "CL")!;
    db.insert(leaveRequests).values({
      employeeId: kiran.employee.id, leaveTypeId: cl.id, startDate: "2026-10-19", endDate: "2026-10-23", startHalf: "full", endHalf: "full",
      days: 5, status: "approved",
    }).run();
    db.update(users).set({ status: "disabled" }).where(eq(users.id, meera.user.id)).run();
    expect(runJobByName(db, "timesheet:remind-employees", FRIDAY)).toEqual({ status: "succeeded", detail: "Reminded 1 employee(s) about the week of 19 Oct" });
    expect(ofType("timesheet.reminder")).toMatchObject([{ userId: ravi.user.id, link: `/me/timesheets/${WEEK}` }]);
    expect(runJobByName(db, "timesheet:remind-employees", FRIDAY).status).toBe("skipped");
  });
});

describe("timesheet:remind-approvers", () => {
  it("tells each approver how many timesheets wait for them", () => {
    submitWeek(asha);
    submitWeek(kiran);
    submitWeek(meera);
    db.delete(notifications).run();
    expect(runJobByName(db, "timesheet:remind-approvers", MONDAY).detail).toBe("Reminded 1 approver(s) about 2 timesheet(s)");
    expect(ofType("timesheet.pending")).toMatchObject([{ userId: ravi.user.id, title: "2 timesheets are waiting for your approval", link: "/approvals?tab=timesheets" }]);
    expect(runJobByName(db, "timesheet:remind-approvers", MONDAY).status).toBe("skipped");
  });
});
