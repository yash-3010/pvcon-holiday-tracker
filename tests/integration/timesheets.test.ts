import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { WeekRowInput } from "@/lib/validation/timesheets";
import type { DB } from "@/server/db/client";
import { leaveRequests, timesheetEntries, timesheets, type EmployeeRow, type ProjectRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { listCategories } from "@/server/modules/projects/queries";
import { addMembers, createClient, createProject, seedTimesheetDefaults, updateProject } from "@/server/modules/projects/service";
import { allowedProjects, saveWeek } from "@/server/modules/timesheets/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

// Wednesday 21 Oct 2026; the week started on Monday the 19th.
const TODAY = "2026-10-21";
const WEEK = "2026-10-19";
let db: DB;
let asha: { employee: EmployeeRow; user: SessionUser };
let web: ProjectRow, internal: ProjectRow, other: ProjectRow;
let dev: number;

const row = (project: ProjectRow, minutes: Record<string, number>, overrides: Partial<WeekRowInput> = {}): WeekRowInput => ({
  projectId: project.id, taskCategoryId: dev, billable: true, notes: "", minutes, ...overrides,
});
const save = (rows: WeekRowInput[], weekStart = WEEK) => saveWeek(db, asha.user, { weekStart, rows }, { today: TODAY });
const entries = () => db.select().from(timesheetEntries).all();

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  seedDefaultLeaveTypes(db);
  seedTimesheetDefaults(db);
  const login = insertUser(db);
  asha = { employee: insertEmployee(db, { dateOfJoining: "2025-01-01", userId: login.id }), user: sessionUserFor(db, login) };
  internal = allowedProjects(db, asha.employee.id, TODAY)[0]!;
  const project = { clientId: null, billableDefault: true, status: "active" as const, startDate: null, endDate: null, budgetHours: null, managerEmployeeId: null };
  web = createProject(db, { ...project, name: "Website", code: "WEB" });
  other = createProject(db, { ...project, name: "Other", code: "OTH" });
  dev = listCategories(db, {})[0]!.id;
});

describe("allowed projects", () => {
  it("offers internal projects to everyone and others to active members inside their dates", () => {
    expect(allowedProjects(db, asha.employee.id, TODAY).map((p) => p.code)).toEqual(["INT", "OTH", "WEB"]);
    const client = createClient(db, { name: "Acme", code: null });
    for (const p of [web, other]) updateProject(db, p.id, { ...p, clientId: client.id });
    expect(allowedProjects(db, asha.employee.id, TODAY).map((p) => p.code)).toEqual(["INT"]);
    addMembers(db, web.id, [asha.employee.id], null);
    expect(allowedProjects(db, asha.employee.id, TODAY).map((p) => p.code)).toEqual(["INT", "WEB"]);
    updateProject(db, web.id, { ...web, clientId: client.id, endDate: "2026-10-20" });
    expect(allowedProjects(db, asha.employee.id, TODAY).map((p) => p.code)).toEqual(["INT"]);
    expect(allowedProjects(db, asha.employee.id, "2026-10-20").map((p) => p.code)).toEqual(["INT", "WEB"]);
  });
});

describe("saving a week", () => {
  it("creates the week and replaces its entries on each save, dropping empty cells", () => {
    const first = save([row(internal, { "2026-10-19": 480, "2026-10-20": 240 }, { notes: "Onboarding" })]);
    expect(first.timesheet).toMatchObject({ weekStart: WEEK, status: "draft" });
    expect(first.warnings).toEqual([]);
    expect(entries().map((e) => [e.date, e.minutes, e.notes])).toEqual([["2026-10-19", 480, "Onboarding"], ["2026-10-20", 240, "Onboarding"]]);
    save([row(internal, { "2026-10-19": 0, "2026-10-21": 60 }, { billable: false })]);
    expect(entries().map((e) => [e.date, e.minutes, e.billable])).toEqual([["2026-10-21", 60, false]]);
    expect(db.select().from(timesheets).all()).toHaveLength(1);
  });

  it("refuses projects the employee may not log to, unless the week already has them", () => {
    const client = createClient(db, { name: "Acme", code: null });
    updateProject(db, web.id, { ...web, clientId: client.id });
    expectDomainError(() => save([row(web, { "2026-10-19": 60 })]), "PROJECT_NOT_ALLOWED");
    addMembers(db, web.id, [asha.employee.id], null);
    save([row(web, { "2026-10-19": 60 })]);
    updateProject(db, web.id, { ...web, clientId: client.id, status: "closed" });
    expect(save([row(web, { "2026-10-19": 120 })]).timesheet.status).toBe("draft");
    expect(entries()[0]!.minutes).toBe(120);
  });

  it("refuses future days and weeks, days before joining, and more than 24 hours a day", () => {
    expectDomainError(() => save([row(internal, { "2026-10-22": 60 })]), "FUTURE_DATE");
    expectDomainError(() => save([], "2026-10-26"), "FUTURE_WEEK");
    const lateLogin = insertUser(db);
    insertEmployee(db, { dateOfJoining: "2026-10-20", userId: lateLogin.id });
    const lateUser = sessionUserFor(db, lateLogin);
    expectDomainError(
      () => saveWeek(db, lateUser, { weekStart: WEEK, rows: [row(internal, { "2026-10-19": 60 })] }, { today: TODAY }),
      "NOT_EMPLOYED",
    );
    expectDomainError(
      () => save([row(internal, { "2026-10-19": 900 }), row(internal, { "2026-10-19": 600 }, { taskCategoryId: listCategories(db, {})[1]!.id })]),
      "DAY_OVER_24H",
    );
  });

  it("locks a submitted or approved week but lets a rejected one change", () => {
    const { timesheet } = save([row(internal, { "2026-10-19": 60 })]);
    db.update(timesheets).set({ status: "submitted" }).where(eq(timesheets.id, timesheet.id)).run();
    expectDomainError(() => save([row(internal, { "2026-10-19": 120 })]), "TIMESHEET_LOCKED");
    db.update(timesheets).set({ status: "rejected" }).where(eq(timesheets.id, timesheet.id)).run();
    expect(save([row(internal, { "2026-10-19": 120 })]).timesheet.status).toBe("rejected");
  });

  it("warns about time logged on a full day of leave", () => {
    const cl = listLeaveTypes(db).find((t) => t.code === "CL")!;
    db.insert(leaveRequests).values({
      employeeId: asha.employee.id, leaveTypeId: cl.id, startDate: "2026-10-20", endDate: "2026-10-20", startHalf: "full", endHalf: "full",
      days: 1, status: "approved",
    }).run();
    expect(save([row(internal, { "2026-10-20": 60 })]).warnings).toEqual(["Tue 20 Oct is a full day of leave."]);
  });

  it("needs an employee record", () => {
    const admin = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
    expectDomainError(() => saveWeek(db, admin, { weekStart: WEEK, rows: [] }, { today: TODAY }), "NO_EMPLOYEE");
  });
});
