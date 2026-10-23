import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { attendanceDays, auditLogs } from "@/server/db/schema";
import { clockIn } from "@/server/modules/attendance/punches";
import { createShift, seedDefaultShift } from "@/server/modules/attendance/shifts";
import { getSetting } from "@/server/modules/settings/service";
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

import { updateAttendanceSettingsAction } from "@/app/(app)/settings/attendance/actions";
import { updateCompOffSettingsAction } from "@/app/(app)/settings/comp-off/actions";

const SIX_DAY = {
  name: "Six day", startTime: "09:00", endTime: "18:00", breakMinutes: 60, graceMinutes: 10, halfDayMinutes: 240,
  fullDayMinutes: 480, weeklyOffs: [0], attendanceMode: "punch" as const, autoClockOutTime: null,
};

beforeEach(() => {
  state.db = createTestDb();
  state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
});

describe("attendance settings", () => {
  it("saves the mode, window and default shift with an audit entry", async () => {
    const general = seedDefaultShift(state.db);
    const six = createShift(state.db, SIX_DAY);
    await expect(
      updateAttendanceSettingsAction({ defaultMode: "auto", regularizationWindowDays: 7, defaultShiftId: six.id }),
    ).resolves.toEqual({ ok: true, data: { defaultMode: "auto", regularizationWindowDays: 7, defaultShiftId: six.id } });
    expect(getSetting(state.db, "attendance")).toMatchObject({ defaultMode: "auto", regularizationWindowDays: 7, defaultShiftId: six.id });
    expect(general.id).not.toBe(six.id);
    expect(state.db.select().from(auditLogs).all().map((a) => [a.action, a.entityId])).toEqual([["settings.update", "attendance"]]);
  });

  it("recomputes today when the default shift changes", async () => {
    // Saturday 7 Nov 2026, in at 09:30 IST and still in at 10:30: an off day on the General shift, a working day on the six-day one.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T05:00:00Z"));
    try {
      seedDefaultShift(state.db);
      const six = createShift(state.db, SIX_DAY);
      const e = insertEmployee(state.db, { dateOfJoining: "2025-01-01", userId: insertUser(state.db).id });
      clockIn(state.db, e.id, { workMode: "office", ip: null, now: new Date("2026-11-07T04:00:00Z") });
      const today = () => state.db.select().from(attendanceDays).where(eq(attendanceDays.employeeId, e.id)).get()!;
      expect(today()).toMatchObject({ status: "weekly_off", lateMinutes: 0 });
      await expect(
        updateAttendanceSettingsAction({ defaultMode: "punch", regularizationWindowDays: 30, defaultShiftId: six.id }),
      ).resolves.toMatchObject({ ok: true });
      // Still in, so the working-day status stays provisional until the day closes.
      expect(today()).toMatchObject({ offDayWorked: false, lateMinutes: 20 });
      expect(today().status).not.toBe("weekly_off");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses an archived or unknown default shift", async () => {
    seedDefaultShift(state.db);
    await expect(
      updateAttendanceSettingsAction({ defaultMode: "punch", regularizationWindowDays: 30, defaultShiftId: 999 }),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("needs attendance.manage", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["manager"] }));
    await expect(
      updateAttendanceSettingsAction({ defaultMode: "punch", regularizationWindowDays: 30, defaultShiftId: 1 }),
    ).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("comp-off settings", () => {
  const VALID = { enabled: true, halfDayMinutes: null, fullDayMinutes: 420, claimWindowDays: 14, expiryDays: 60, payoutEnabled: true };

  it("saves with blank thresholds meaning the shift's", async () => {
    await expect(updateCompOffSettingsAction(VALID)).resolves.toEqual({ ok: true, data: VALID });
    expect(getSetting(state.db, "compOff")).toEqual(VALID);
    expect(state.db.select().from(auditLogs).all().map((a) => [a.action, a.entityId])).toEqual([["settings.update", "compOff"]]);
  });

  it("wants the half-day threshold below the full-day one", async () => {
    await expect(updateCompOffSettingsAction({ ...VALID, halfDayMinutes: 480 })).resolves.toMatchObject({
      ok: false, code: "VALIDATION", fieldErrors: { halfDayMinutes: ["Must be less than the full-day threshold"] },
    });
  });

  it("needs leave.config", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["manager"] }));
    await expect(updateCompOffSettingsAction(VALID)).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
