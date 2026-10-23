import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ATTENDANCE_CODES, ATTENDANCE_STATUSES } from "@/lib/attendance";
import {
  compOffGrantSchema, overrideSchema, regularizationSchema, shiftSchema,
} from "@/lib/validation/attendance";

const fieldErrors = (result: { success: boolean; error?: z.ZodError }) =>
  result.success ? {} : (z.flattenError(result.error!).fieldErrors as Record<string, string[]>);

const general = {
  name: "General", startTime: "09:30", endTime: "18:30", breakMinutes: 60, graceMinutes: 15, halfDayMinutes: 240,
  fullDayMinutes: 480, weeklyOffs: [6, 0], attendanceMode: "punch", autoClockOutTime: "23:30",
};

describe("shiftSchema", () => {
  it("accepts a day shift and sorts its weekly offs", () => {
    expect(shiftSchema.parse(general).weeklyOffs).toEqual([0, 6]);
    expect(shiftSchema.parse({ ...general, autoClockOutTime: "" }).autoClockOutTime).toBeNull();
  });

  it("refuses shifts that end before they start or have impossible thresholds", () => {
    expect(fieldErrors(shiftSchema.safeParse({ ...general, endTime: "09:00" }))).toHaveProperty("endTime");
    expect(fieldErrors(shiftSchema.safeParse({ ...general, halfDayMinutes: 480 }))).toHaveProperty("halfDayMinutes");
    expect(fieldErrors(shiftSchema.safeParse({ ...general, fullDayMinutes: 600 }))).toHaveProperty("fullDayMinutes");
    expect(fieldErrors(shiftSchema.safeParse({ ...general, autoClockOutTime: "18:00" }))).toHaveProperty("autoClockOutTime");
    expect(fieldErrors(shiftSchema.safeParse({ ...general, startTime: "9:30" }))).toHaveProperty("startTime");
  });
});

describe("other attendance schemas", () => {
  it("needs a regularization to end after it starts, with a reason", () => {
    const ok = { date: "2026-11-07", requestedIn: "10:00", requestedOut: "18:30", reason: "Release work" };
    expect(regularizationSchema.parse(ok)).toMatchObject({ requestedIn: 600, requestedOut: 1110 });
    expect(fieldErrors(regularizationSchema.safeParse({ ...ok, requestedOut: "09:00" }))).toHaveProperty("requestedOut");
    expect(fieldErrors(regularizationSchema.safeParse({ ...ok, reason: "" }))).toHaveProperty("reason");
  });

  it("needs a note to override a day, but not to clear one", () => {
    expect(fieldErrors(overrideSchema.safeParse({ employeeId: 1, date: "2026-11-02", status: "present", note: "" }))).toHaveProperty("note");
    expect(overrideSchema.safeParse({ employeeId: 1, date: "2026-11-02", status: null, note: "" }).success).toBe(true);
  });

  it("grants comp-off in half days with a note", () => {
    expect(compOffGrantSchema.safeParse({ employeeId: 1, days: 1.5, earnedOn: "2026-11-07", note: "Client visit" }).success).toBe(true);
    expect(fieldErrors(compOffGrantSchema.safeParse({ employeeId: 1, days: 0.3, earnedOn: "2026-11-07", note: "x y z" }))).toHaveProperty("days");
  });

  it("has a muster code for every status", () => {
    expect(ATTENDANCE_STATUSES.every((s) => ATTENDANCE_CODES[s].length > 0)).toBe(true);
  });
});
