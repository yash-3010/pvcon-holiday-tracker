import { describe, expect, it } from "vitest";
import {
  addDays, addMonths, dateInTimeZone, dayOfWeek, daysInMonth, diffDays, eachDay, formatDate, formatDateTime,
  formatHm, formatMinutes, formatPeriod, isISODate, isPeriod, minutesInZone, monthRange, parseHm, periodOf, startOfWeek,
  toUTCDate, zonedInstant,
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

describe("time-zone conversion", () => {
  it("reads local minutes and dates of an instant", () => {
    expect([dateInTimeZone(new Date("2026-11-02T18:20:00Z"), "Asia/Kolkata"), minutesInZone(new Date("2026-11-02T18:20:00Z"), "Asia/Kolkata")]).toEqual([
      "2026-11-02", 23 * 60 + 50,
    ]);
    expect([dateInTimeZone(new Date("2026-11-02T18:40:00Z"), "Asia/Kolkata"), minutesInZone(new Date("2026-11-02T18:40:00Z"), "Asia/Kolkata")]).toEqual([
      "2026-11-03", 10,
    ]);
  });

  it("turns a local date and time into the right instant", () => {
    expect(zonedInstant("2026-11-02", 9 * 60 + 30, "Asia/Kolkata").toISOString()).toBe("2026-11-02T04:00:00.000Z");
    expect(zonedInstant("2026-11-02", 0, "Asia/Kolkata").toISOString()).toBe("2026-11-01T18:30:00.000Z");
    expect(zonedInstant("2026-07-01", 9 * 60, "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedInstant("2026-01-15", 9 * 60, "America/New_York").toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });

  it("moves a time that does not exist in a DST gap forward", () => {
    // 02:30 on 8 March 2026 is skipped in New York; 03:30 EDT is 07:30Z.
    expect(zonedInstant("2026-03-08", 2 * 60 + 30, "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("parses and formats clock times and durations", () => {
    expect(parseHm("09:30")).toBe(570);
    expect(parseHm("23:59")).toBe(1439);
    expect(() => parseHm("24:00")).toThrow(RangeError);
    expect(() => parseHm("9:3")).toThrow(RangeError);
    expect(formatHm(570)).toBe("09:30");
    expect([0, 45, 60, 125].map(formatMinutes)).toEqual(["0m", "45m", "1h 00m", "2h 05m"]);
  });
});
