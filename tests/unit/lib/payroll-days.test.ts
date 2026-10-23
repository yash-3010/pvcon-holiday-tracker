import { describe, expect, it } from "vitest";
import { summarizeDays, type PayrollDay } from "@/lib/payroll/days";

// November 2026 starts on a Sunday; weekends are off.
const november = (overrides: Record<number, Partial<PayrollDay>> = {}): PayrollDay[] =>
  Array.from({ length: 30 }, (_, i) => {
    const date = `2026-11-${String(i + 1).padStart(2, "0")}`;
    const weekday = (i + 0) % 7; // the 1st is a Sunday
    const working = weekday !== 0 && weekday !== 6;
    return { date, status: working ? "present" : "weekly_off", working, lopLeave: 0, otherHalfWorked: null, ...overrides[i + 1] } as PayrollDay;
  });

describe("summarizeDays", () => {
  it("pays every day of a full month", () => {
    expect(summarizeDays(november(), "calendar")).toEqual({ TOTAL_DAYS: 30, WORKING_DAYS: 21, PAID_DAYS: 30, LOP_DAYS: 0, PRESENT_DAYS: 21 });
    expect(summarizeDays(november(), "working")).toEqual({ TOTAL_DAYS: 21, WORKING_DAYS: 21, PAID_DAYS: 21, LOP_DAYS: 0, PRESENT_DAYS: 21 });
  });

  it("counts absences, half days and leave without pay", () => {
    const days = november({
      2: { status: "absent" },
      3: { status: "half_day" },
      4: { status: "on_leave", lopLeave: 1 },
      5: { status: "on_leave", lopLeave: 0 },
      9: { status: "half_leave", lopLeave: 0.5, otherHalfWorked: true },
      10: { status: "half_leave", lopLeave: 0, otherHalfWorked: false },
      11: { status: "half_leave", lopLeave: 0.5, otherHalfWorked: false },
      12: { status: "half_leave", lopLeave: 0, otherHalfWorked: null },
    });
    // LOP: 1 + ½ + 1 + 0 + ½ + ½ + 1 + 0. Present: 13 untouched working days + ½ (3rd) + ½ (9th) + ½ (12th).
    expect(summarizeDays(days, "calendar")).toEqual({ TOTAL_DAYS: 30, WORKING_DAYS: 21, PAID_DAYS: 25.5, LOP_DAYS: 4.5, PRESENT_DAYS: 14.5 });
  });

  it("charges days before joining and after leaving, and on the working basis only working ones", () => {
    const joiner = november(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 1, { status: "not_joined" }])));
    expect(summarizeDays(joiner, "calendar")).toMatchObject({ TOTAL_DAYS: 30, LOP_DAYS: 9, PAID_DAYS: 21 });
    // 2–6 and 9 Nov are the working days before the 10th.
    expect(summarizeDays(joiner, "working")).toMatchObject({ TOTAL_DAYS: 21, LOP_DAYS: 6, PAID_DAYS: 15 });
    const leaver = november(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 21, { status: "exited" }])));
    expect(summarizeDays(leaver, "calendar")).toMatchObject({ LOP_DAYS: 10, PAID_DAYS: 20 });
  });

  it("treats projected future days as present", () => {
    const days = november(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 21, { status: "projected" }])));
    expect(summarizeDays(days, "calendar")).toMatchObject({ PAID_DAYS: 30, LOP_DAYS: 0 });
  });
});
