import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { attendanceDays, auditLogs, employees, shifts, type ShiftRow } from "@/server/db/schema";
import { clockIn } from "@/server/modules/attendance/punches";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { archiveShiftAction, assignShiftAction, createShiftAction, updateShiftAction } from "@/app/(app)/time/shifts/actions";

const SIX_DAY = {
  name: "Six day", startTime: "09:00", endTime: "18:00", breakMinutes: 60, graceMinutes: 10, halfDayMinutes: 240,
  fullDayMinutes: 480, weeklyOffs: [0], attendanceMode: "punch" as const, autoClockOutTime: "",
};
let general: ShiftRow;
const audits = () => state.db.select().from(auditLogs).all().map((a) => a.action);
const employeeShift = (id: number) => state.db.select({ shiftId: employees.shiftId }).from(employees).where(eq(employees.id, id)).get()!.shiftId;
const todayRow = (id: number) => state.db.select().from(attendanceDays).where(eq(attendanceDays.employeeId, id)).get()!;

async function createSixDay(): Promise<number> {
  const result = await createShiftAction(SIX_DAY);
  if (!result.ok) throw new Error(result.error);
  return result.data.id;
}

beforeEach(() => {
  // Saturday 7 Nov 2026, 10:30 IST: an off day on General, a working day on Six day.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-07T05:00:00Z"));
  state.db = createTestDb();
  general = seedDefaultShift(state.db);
  state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
});
afterEach(() => vi.useRealTimers());

describe("shift actions", () => {
  it("creates a shift and refuses a duplicate name", async () => {
    const id = await createSixDay();
    expect(state.db.select().from(shifts).where(eq(shifts.id, id)).get()).toMatchObject({ name: "Six day", weeklyOffs: [0], autoClockOutTime: null });
    await expect(createShiftAction({ ...SIX_DAY, name: "six DAY" })).resolves.toMatchObject({
      ok: false, code: "DUPLICATE_NAME", fieldErrors: { name: ["Already exists"] },
    });
    expect(audits()).toEqual(["shift.create"]);
  });

  it("validates times", async () => {
    await expect(createShiftAction({ ...SIX_DAY, endTime: "08:00" })).resolves.toMatchObject({
      code: "VALIDATION", fieldErrors: { endTime: ["Must be after the start (shifts can't cross midnight)"] },
    });
  });

  it("updates a shift and recomputes today for the people on it", async () => {
    const e = insertEmployee(state.db, { dateOfJoining: "2025-01-01", userId: insertUser(state.db).id });
    clockIn(state.db, e.id, { workMode: "office", ip: null, now: new Date("2026-11-07T04:00:00Z") });
    expect(todayRow(e.id).status).toBe("weekly_off");
    const result = await updateShiftAction({ id: general.id, ...SIX_DAY, name: "General", weeklyOffs: [0] });
    expect(result).toMatchObject({ ok: true });
    expect(todayRow(e.id)).toMatchObject({ offDayWorked: false, lateMinutes: 20 });
    const entry = state.db.select().from(auditLogs).get()!;
    expect(entry).toMatchObject({ action: "shift.update", entityType: "shift", entityId: String(general.id) });
    expect(entry.diff).toMatchObject({ weeklyOffs: { from: [0, 6], to: [0] } });
  });

  it("assigns employees, recomputing their day, and moves them back to the default", async () => {
    const six = await createSixDay();
    const a = insertEmployee(state.db, { dateOfJoining: "2025-01-01", userId: insertUser(state.db).id });
    const b = insertEmployee(state.db, { dateOfJoining: "2025-01-01" });
    clockIn(state.db, a.id, { workMode: "office", ip: null, now: new Date("2026-11-07T04:00:00Z") });
    await expect(assignShiftAction({ shiftId: six, employeeIds: [a.id, b.id] })).resolves.toEqual({ ok: true, data: { assigned: 2 } });
    expect([employeeShift(a.id), employeeShift(b.id)]).toEqual([six, six]);
    expect(todayRow(a.id).status).not.toBe("weekly_off");
    await expect(assignShiftAction({ shiftId: null, employeeIds: [a.id] })).resolves.toEqual({ ok: true, data: { assigned: 1 } });
    expect(employeeShift(a.id)).toBeNull();
    expect(todayRow(a.id).status).toBe("weekly_off");
    expect(audits()).toEqual(["shift.create", "shift.assign", "shift.assign"]);
  });

  it("archives only a shift that is neither the default nor in use", async () => {
    const six = await createSixDay();
    await expect(archiveShiftAction({ id: general.id, archived: true })).resolves.toMatchObject({ code: "DEFAULT_SHIFT" });
    const e = insertEmployee(state.db, { dateOfJoining: "2025-01-01" });
    await assignShiftAction({ shiftId: six, employeeIds: [e.id] });
    await expect(archiveShiftAction({ id: six, archived: true })).resolves.toMatchObject({ code: "SHIFT_IN_USE" });
    await assignShiftAction({ shiftId: null, employeeIds: [e.id] });
    await expect(archiveShiftAction({ id: six, archived: true })).resolves.toEqual({ ok: true, data: { archived: true } });
    await expect(assignShiftAction({ shiftId: six, employeeIds: [e.id] })).resolves.toMatchObject({ code: "ARCHIVED" });
    expect(audits().filter((a) => a === "shift.archive")).toHaveLength(1);
  });

  it("needs shift.manage", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["manager"] }));
    await expect(createShiftAction(SIX_DAY)).resolves.toMatchObject({ code: "FORBIDDEN" });
    await expect(assignShiftAction({ shiftId: general.id, employeeIds: [1] })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
