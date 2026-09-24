import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, dateInTimeZone, dayOfWeek, daysInMonth, diffDays, eachDay, formatDate, formatDateTime,
  formatPeriod, isISODate, isPeriod, monthRange, periodOf, startOfWeek, toUTCDate,
} from "@/lib/dates";

describe("dates", () => {
  it("validates ISO dates including leap years", () => {
    expect(isISODate("2026-09-24")).toBe(true);
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2028-02-29")).toBe(true);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("26-09-24")).toBe(false);
    expect(() => toUTCDate("nope")).toThrow(RangeError);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("diffs and enumerates days inclusively", () => {
    expect(diffDays("2026-09-01", "2026-09-30")).toBe(29);
    expect(eachDay("2026-09-28", "2026-10-02")).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02",
    ]);
    expect(eachDay("2026-10-02", "2026-10-01")).toEqual([]);
  });

  it("computes weekday and Monday week start in UTC", () => {
    expect(dayOfWeek("2026-09-24")).toBe(4); // Thursday
    expect(startOfWeek("2026-09-24")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21"); // Sunday belongs to the week starting Monday 21st
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21");
  });

  it("handles periods", () => {
    expect(isPeriod("2026-09")).toBe(true);
    expect(isPeriod("2026-00")).toBe(false);
    expect(periodOf("2026-09-24")).toBe("2026-09");
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(monthRange("2026-09")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("converts instants to calendar dates in a timezone", () => {
    const instant = new Date("2026-09-23T20:00:00Z");
    expect(dateInTimeZone(instant, "Asia/Kolkata")).toBe("2026-09-24");
    expect(dateInTimeZone(instant, "UTC")).toBe("2026-09-23");
  });

  it("formats dates without timezone drift", () => {
    expect(formatDate("2026-01-05")).toBe("05 Jan 2026");
    expect(formatPeriod("2026-09")).toBe("September 2026");
  });
});

describe("formatDateTime", () => {
  it("formats instants in the company timezone", () => {
    expect(formatDateTime("2026-09-23T20:00:00.000Z", "Asia/Kolkata")).toMatch(/24 .*2026.*1:30/);
  });
});
