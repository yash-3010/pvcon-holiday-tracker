import { describe, expect, it } from "vitest";
import {
  dayAvailableMinutes, formatHours, hoursToMinutes, isQuarterHour, isWeekStart, minutesToHours, roundTimerMinutes, utilization,
  weekDates,
} from "@/lib/timesheets";

describe("quarter hours", () => {
  it("converts between hours and minutes on the quarter-hour grid", () => {
    expect(hoursToMinutes(1.25)).toBe(75);
    expect(hoursToMinutes(1.3)).toBe(75);
    expect(hoursToMinutes(1.4)).toBe(90);
    expect(hoursToMinutes(0)).toBe(0);
    expect(minutesToHours(75)).toBe(1.25);
    expect(isQuarterHour(45)).toBe(true);
    expect(isQuarterHour(20)).toBe(false);
  });

  it("formats hours without trailing zeros", () => {
    expect(formatHours(480)).toBe("8");
    expect(formatHours(450)).toBe("7.5");
    expect(formatHours(75)).toBe("1.25");
    expect(formatHours(0)).toBe("0");
  });

  it("rounds a timer to the nearest quarter and drops very short runs", () => {
    expect(roundTimerMinutes(7)).toBe(0);
    expect(roundTimerMinutes(8)).toBe(15);
    expect(roundTimerMinutes(22)).toBe(15);
    expect(roundTimerMinutes(23)).toBe(30);
    expect(roundTimerMinutes(67)).toBe(60);
  });
});

describe("weeks", () => {
  it("lists Monday to Sunday and recognises a Monday", () => {
    expect(weekDates("2026-10-19")).toEqual([
      "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25",
    ]);
    expect(isWeekStart("2026-10-19")).toBe(true);
    expect(isWeekStart("2026-10-18")).toBe(false);
    expect(isWeekStart("not a date")).toBe(false);
  });
});

describe("availability and utilization", () => {
  it("gives a working day the shift, a half-day leave half of it and other days nothing", () => {
    expect(dayAvailableMinutes("working", 480)).toBe(480);
    expect(dayAvailableMinutes("half_leave", 480)).toBe(240);
    expect(dayAvailableMinutes("half_leave", 450)).toBe(225);
    expect(dayAvailableMinutes("half_leave", 460)).toBe(225);
    for (const kind of ["leave", "holiday", "weekly_off", "not_employed"] as const) expect(dayAvailableMinutes(kind, 480)).toBe(0);
  });

  it("computes utilization and billable shares with one decimal, or null without a base", () => {
    expect(utilization({ availableMinutes: 2400, loggedMinutes: 2100, billableMinutes: 1500 })).toEqual({ utilizationPct: 87.5, billablePct: 71.4 });
    expect(utilization({ availableMinutes: 0, loggedMinutes: 60, billableMinutes: 0 })).toEqual({ utilizationPct: null, billablePct: 0 });
    expect(utilization({ availableMinutes: 480, loggedMinutes: 0, billableMinutes: 0 })).toEqual({ utilizationPct: 0, billablePct: null });
  });
});
