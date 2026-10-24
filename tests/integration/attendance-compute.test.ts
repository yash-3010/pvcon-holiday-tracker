import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { attendanceDays, attendancePunches, type EmployeeRow, type LeaveTypeRow } from "@/server/db/schema";
import { recomputeAttendance, recomputeDateForAll } from "@/server/modules/attendance/compute";
import { clearOverride, setOverride } from "@/server/modules/attendance/overrides";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { createHoliday } from "@/server/modules/holidays/service";
import { syncEntitlements } from "@/server/modules/leave/ledger";
import { applyLeaveOnBehalf, cancelLeave } from "@/server/modules/leave/requests";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

// Wednesday 4 Nov 2026, 17:30 in India.
const NOW = new Date("2026-11-04T12:00:00Z");
let db: DB;
let asha: EmployeeRow;
let hr: SessionUser;
let cl: LeaveTypeRow;

function punch(employeeId: number, at: string, direction: "in" | "out", source: "web" | "regularization" = "web") {
  db.insert(attendancePunches).values({ employeeId, at, date: at.slice(0, 10), direction, source }).run();
}
const day = (date: string) =>
  db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, asha.id), eq(attendanceDays.date, date))).get();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  db = createTestDb();
  seedDefaultShift(db);
  seedDefaultLeaveTypes(db);
  cl = listLeaveTypes(db).find((t) => t.code === "CL")!;
  asha = insertEmployee(db, { firstName: "Asha", dateOfJoining: "2025-01-01" });
  syncEntitlements(db, asha.id, "2026-11-04");
  hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
});

afterEach(() => vi.useRealTimers());

describe("recomputeAttendance", () => {
  it("computes past days and today, but never the future", () => {
    punch(asha.id, "2026-11-02T04:00:00.000Z", "in");
    punch(asha.id, "2026-11-02T13:00:00.000Z", "out");
    punch(asha.id, "2026-11-04T04:00:00.000Z", "in");
    expect(recomputeAttendance(db, asha.id, "2026-11-02", "2026-11-06", { now: NOW })).toEqual({ written: 3, skippedLocked: 0 });
    expect(day("2026-11-02")).toMatchObject({ status: "present", firstIn: 570, lastOut: 1110, workedMinutes: 540 });
    expect(day("2026-11-03")).toMatchObject({ status: "absent", workedMinutes: 0 });
    expect(day("2026-11-04")).toMatchObject({ status: "present", workedMinutes: 480, lastOut: null });
    expect(day("2026-11-05")).toBeUndefined();
  });

  it("never writes days before joining", () => {
    const joiner = insertEmployee(db, { dateOfJoining: "2026-11-03" });
    expect(recomputeAttendance(db, joiner.id, "2026-11-01", "2026-11-04", { now: NOW }).written).toBe(2);
  });

  it("lets regularization punches replace the day's other punches", () => {
    punch(asha.id, "2026-11-03T04:00:00.000Z", "in");
    punch(asha.id, "2026-11-03T06:00:00.000Z", "out");
    punch(asha.id, "2026-11-03T04:30:00.000Z", "in", "regularization");
    punch(asha.id, "2026-11-03T13:00:00.000Z", "out", "regularization");
    recomputeAttendance(db, asha.id, "2026-11-03", "2026-11-03", { now: NOW });
    expect(day("2026-11-03")).toMatchObject({ status: "present", firstIn: 600, workedMinutes: 510 });
  });

  it("keeps payroll-locked days as they are", () => {
    recomputeAttendance(db, asha.id, "2026-11-03", "2026-11-03", { now: NOW });
    db.update(attendanceDays).set({ locked: true }).run();
    punch(asha.id, "2026-11-03T04:00:00.000Z", "in");
    punch(asha.id, "2026-11-03T13:00:00.000Z", "out");
    expect(recomputeAttendance(db, asha.id, "2026-11-03", "2026-11-03", { now: NOW })).toEqual({ written: 0, skippedLocked: 1 });
    expect(day("2026-11-03")!.status).toBe("absent");
  });
});

describe("hooks", () => {
  it("marks approved leave and restores the day when it is cancelled", () => {
    recomputeAttendance(db, asha.id, "2026-11-03", "2026-11-03", { now: NOW });
    const request = applyLeaveOnBehalf(
      db, hr,
      { employeeId: asha.id, leaveTypeId: cl.id, startDate: "2026-11-03", endDate: "2026-11-03", startHalf: "full", endHalf: "full", reason: null },
      { today: "2026-11-04", attachmentFileId: null },
    );
    expect(day("2026-11-03")).toMatchObject({ status: "on_leave", leaveRequestId: request.id });
    cancelLeave(db, hr, request.id, "Came in", { today: "2026-11-04" });
    expect(day("2026-11-03")).toMatchObject({ status: "absent", leaveRequestId: null });
  });

  it("recomputes everyone when a past holiday is added", () => {
    const kiran = insertEmployee(db, { dateOfJoining: "2025-01-01" });
    punch(asha.id, "2026-11-02T04:00:00.000Z", "in");
    punch(asha.id, "2026-11-02T13:00:00.000Z", "out");
    createHoliday(db, { date: "2026-11-02", name: "Festival", type: "fixed" });
    expect(day("2026-11-02")).toMatchObject({ status: "holiday", offDayWorked: true, overtimeMinutes: 540 });
    expect(db.select().from(attendanceDays).where(eq(attendanceDays.employeeId, kiran.id)).get()).toMatchObject({ status: "holiday" });
    expect(recomputeDateForAll(db, "2026-11-10", { now: NOW })).toBe(0);
  });
});

describe("overrides", () => {
  it("wins over the computed status until cleared", () => {
    setOverride(db, hr.id, { employeeId: asha.id, date: "2026-11-03", status: "present", note: "Client site" }, { now: NOW });
    expect(day("2026-11-03")).toMatchObject({ status: "present", overrideStatus: "present", overrideNote: "Client site", overrideBy: hr.id });
    clearOverride(db, { employeeId: asha.id, date: "2026-11-03" }, { now: NOW });
    expect(day("2026-11-03")).toMatchObject({ status: "absent", overrideStatus: null });
  });

  it("refuses future, pre-joining and locked days", () => {
    expectDomainError(() => setOverride(db, hr.id, { employeeId: asha.id, date: "2026-11-05", status: "present", note: "x y z" }, { now: NOW }), "FUTURE_DATE");
    expectDomainError(() => setOverride(db, hr.id, { employeeId: asha.id, date: "2024-12-31", status: "present", note: "x y z" }, { now: NOW }), "NOT_EMPLOYED");
    recomputeAttendance(db, asha.id, "2026-11-03", "2026-11-03", { now: NOW });
    db.update(attendanceDays).set({ locked: true }).run();
    expectDomainError(() => setOverride(db, hr.id, { employeeId: asha.id, date: "2026-11-03", status: "present", note: "x y z" }, { now: NOW }), "DAY_LOCKED");
  });
});
