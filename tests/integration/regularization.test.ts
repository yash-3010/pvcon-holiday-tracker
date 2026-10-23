import { and, asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { attendanceDays, attendancePunches, notifications, type EmployeeRow } from "@/server/db/schema";
import { recomputeAttendance } from "@/server/modules/attendance/compute";
import {
  approveRegularization, rejectRegularization, requestRegularization, withdrawRegularization,
} from "@/server/modules/attendance/regularization";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

// Wednesday 4 Nov 2026, 17:30 IST.
const NOW = new Date("2026-11-04T12:00:00Z");
const TODAY = "2026-11-04";
let db: DB;
type Person = { employee: EmployeeRow; user: SessionUser };
let ravi: Person, asha: Person, hr: SessionUser;

function person(name: string, overrides: Partial<EmployeeRow> = {}, roles: ("employee" | "hr_admin")[] = ["employee"]): Person {
  const login = insertUser(db, { roles, name });
  const employee = insertEmployee(db, { firstName: name, dateOfJoining: "2025-01-01", userId: login.id, ...overrides });
  return { employee, user: sessionUserFor(db, login) };
}
const input = (date: string, overrides = {}) => ({ date, requestedIn: 600, requestedOut: 1110, reason: "Forgot to clock in", ...overrides });
const day = (date: string) =>
  db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, asha.employee.id), eq(attendanceDays.date, date))).get();

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  hr = person("Hema", {}, ["employee", "hr_admin"]).user;
  ravi = person("Ravi");
  asha = person("Asha", { reportingManagerId: ravi.employee.id });
  ravi = { ...ravi, user: sessionUserFor(db, getUserById(db, ravi.user.id)!) };
});

describe("requesting", () => {
  it("accepts a past day in the window and tells the manager", () => {
    const request = requestRegularization(db, asha.user, input("2026-11-03"), { today: TODAY });
    expect(request).toMatchObject({ status: "pending", requestedIn: 600, requestedOut: 1110 });
    expect(db.select({ userId: notifications.userId, type: notifications.type }).from(notifications).all()).toEqual([
      { userId: ravi.user.id, type: "regularization.submitted" },
    ]);
  });

  it("refuses today, the future, old days, days before joining and a second pending request", () => {
    expectDomainError(() => requestRegularization(db, asha.user, input(TODAY), { today: TODAY }), "FUTURE_DATE");
    expectDomainError(() => requestRegularization(db, asha.user, input("2026-09-30"), { today: TODAY }), "OUTSIDE_WINDOW");
    const joiner = person("Kiran", { dateOfJoining: "2026-11-04" });
    expectDomainError(() => requestRegularization(db, joiner.user, input("2026-11-03"), { today: TODAY }), "NOT_EMPLOYED");
    requestRegularization(db, asha.user, input("2026-11-03"), { today: TODAY });
    expectDomainError(() => requestRegularization(db, asha.user, input("2026-11-03"), { today: TODAY }), "ALREADY_PENDING");
  });

  it("refuses a payroll-locked day", () => {
    recomputeAttendance(db, asha.employee.id, "2026-11-03", "2026-11-03", { now: NOW });
    db.update(attendanceDays).set({ locked: true }).run();
    expectDomainError(() => requestRegularization(db, asha.user, input("2026-11-03"), { today: TODAY }), "DAY_LOCKED");
  });
});

describe("deciding", () => {
  it("turns an absent day present with regularization punches that replace the others", () => {
    db.insert(attendancePunches).values({ employeeId: asha.employee.id, at: "2026-11-03T04:00:00.000Z", date: "2026-11-03", direction: "in" }).run();
    recomputeAttendance(db, asha.employee.id, "2026-11-03", "2026-11-03", { now: NOW });
    expect(day("2026-11-03")!.status).toBe("absent");
    const request = requestRegularization(db, asha.user, input("2026-11-03"), { today: TODAY });
    expect(approveRegularization(db, ravi.user, request.id, "OK", { now: NOW })).toMatchObject({ status: "approved", approverId: ravi.user.id });
    expect(day("2026-11-03")).toMatchObject({ status: "present", firstIn: 600, lastOut: 1110, workedMinutes: 510 });
    const corrected = db.select().from(attendancePunches).where(eq(attendancePunches.source, "regularization")).orderBy(asc(attendancePunches.at)).all();
    expect(corrected.map((p) => [p.at, p.direction, p.createdBy])).toEqual([
      ["2026-11-03T04:30:00.000Z", "in", ravi.user.id],
      ["2026-11-03T13:00:00.000Z", "out", ravi.user.id],
    ]);
    expect(db.select({ type: notifications.type }).from(notifications).all().map((n) => n.type)).toContain("regularization.approved");
  });

  it("keeps decisions inside the reporting line and away from the applicant", () => {
    const peer = person("Meera");
    const request = requestRegularization(db, asha.user, input("2026-11-03"), { today: TODAY });
    expectDomainError(() => approveRegularization(db, peer.user, request.id, null, { now: NOW }), "FORBIDDEN");
    const own = requestRegularization(db, hr, input("2026-11-03"), { today: TODAY });
    expectDomainError(() => approveRegularization(db, hr, own.id, null, { now: NOW }), "SELF_APPROVAL");
    expect(rejectRegularization(db, hr, request.id, "No proof").status).toBe("rejected");
    expectDomainError(() => rejectRegularization(db, hr, request.id, null), "NOT_PENDING");
  });

  it("lets the employee withdraw a pending request only", () => {
    const request = requestRegularization(db, asha.user, input("2026-11-03"), { today: TODAY });
    expectDomainError(() => withdrawRegularization(db, ravi.user, request.id), "FORBIDDEN");
    expect(withdrawRegularization(db, asha.user, request.id).status).toBe("withdrawn");
  });
});
