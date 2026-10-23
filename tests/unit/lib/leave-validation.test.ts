import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatDays } from "@/lib/leave";
import {
  adjustmentSchema, applyLeaveSchema, holidaySchema, leaveSettingsFormSchema, leaveTypeSchema,
} from "@/lib/validation/leave";

const fieldErrors = (result: { success: boolean; error?: z.ZodError }) =>
  result.success ? {} : (z.flattenError(result.error!).fieldErrors as Record<string, string[]>);

const casual = {
  code: "CL", name: "Casual leave", color: "#2563eb", paid: true, isLop: false, accrual: "upfront", annualQuota: 12,
  carryForwardMax: 6, encashable: false, allowHalfDay: true, allowNegative: false, maxConsecutiveDays: 3, minNoticeDays: 1,
  attachmentAfterDays: null, countWeekends: false, applicableEmploymentTypes: null,
};
const apply = {
  leaveTypeId: 1, startDate: "2026-11-02", endDate: "2026-11-04", startHalf: "full", endHalf: "full", reason: "",
};

describe("leaveTypeSchema", () => {
  it("accepts a typical type and normalises the code", () => {
    expect(leaveTypeSchema.parse({ ...casual, code: " cl " })).toMatchObject({ code: "CL", annualQuota: 12 });
  });

  it("rejects bad codes, quotas off the half-day grid and unpaid LOP mix-ups", () => {
    expect(fieldErrors(leaveTypeSchema.safeParse({ ...casual, code: "C L" }))).toHaveProperty("code");
    expect(fieldErrors(leaveTypeSchema.safeParse({ ...casual, annualQuota: 0.3 }))).toHaveProperty("annualQuota");
    expect(fieldErrors(leaveTypeSchema.safeParse({ ...casual, isLop: true }))).toHaveProperty("paid");
    expect(fieldErrors(leaveTypeSchema.safeParse({ ...casual, color: "blue" }))).toHaveProperty("color");
    expect(fieldErrors(leaveTypeSchema.safeParse({ ...casual, applicableEmploymentTypes: [] }))).toHaveProperty("applicableEmploymentTypes");
  });
});

describe("applyLeaveSchema", () => {
  it("accepts a range and turns an empty reason into null", () => {
    expect(applyLeaveSchema.parse(apply)).toMatchObject({ startDate: "2026-11-02", reason: null });
  });

  it("reports the end date when it is before the start", () => {
    expect(fieldErrors(applyLeaveSchema.safeParse({ ...apply, endDate: "2026-11-01" }))).toHaveProperty("endDate");
  });

  it("reports impossible half-day combinations on the start half", () => {
    expect(fieldErrors(applyLeaveSchema.safeParse({ ...apply, startHalf: "first_half" }))).toHaveProperty("startHalf");
    expect(fieldErrors(applyLeaveSchema.safeParse({ ...apply, endDate: apply.startDate, startHalf: "first_half", endHalf: "second_half" }))).toHaveProperty("startHalf");
    expect(applyLeaveSchema.safeParse({ ...apply, endDate: apply.startDate, startHalf: "second_half", endHalf: "second_half" }).success).toBe(true);
  });
});

describe("adjustmentSchema", () => {
  const adjustment = { employeeId: 1, leaveTypeId: 1, year: 2026, delta: -1.5, note: "Correction for June" };

  it("accepts a half-step delta with a note", () => {
    expect(adjustmentSchema.parse(adjustment)).toMatchObject({ delta: -1.5 });
  });

  it("rejects zero, quarter days and a missing note", () => {
    expect(fieldErrors(adjustmentSchema.safeParse({ ...adjustment, delta: 0 }))).toHaveProperty("delta");
    expect(fieldErrors(adjustmentSchema.safeParse({ ...adjustment, delta: 0.25 }))).toHaveProperty("delta");
    expect(fieldErrors(adjustmentSchema.safeParse({ ...adjustment, note: "  " }))).toHaveProperty("note");
  });
});

describe("other leave schemas", () => {
  it("validates holidays and leave settings", () => {
    expect(holidaySchema.safeParse({ date: "2026-02-30", name: "X", type: "fixed" }).success).toBe(false);
    expect(holidaySchema.parse({ date: "2026-01-26", name: " Republic Day ", type: "fixed" }).name).toBe("Republic Day");
    expect(leaveSettingsFormSchema.safeParse({ yearStartMonth: 4, weeklyOffs: [0, 0] }).success).toBe(false);
    expect(leaveSettingsFormSchema.parse({ yearStartMonth: 4, weeklyOffs: [6, 0] }).weeklyOffs).toEqual([0, 6]);
  });
});

describe("formatDays", () => {
  it("uses half fractions", () => {
    expect([1, 0.5, 2.5, 3, -1, 0].map(formatDays)).toEqual(["1 day", "½ day", "2½ days", "3 days", "-1 day", "0 days"]);
  });
});
