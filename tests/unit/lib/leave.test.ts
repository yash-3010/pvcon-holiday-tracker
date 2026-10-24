import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accrualCredit, countLeaveDays, floorHalf, leaveYearMonthIndex, leaveYearOf, leaveYearRange, portionsOverlap,
  proRatedQuota, requestPortions, roundHalf, type LeaveHalf,
} from "@/lib/leave";

const weekend = [0, 6];
// 2026-11-02 is a Monday.
const count = (
  start: string,
  end: string,
  opts: { startHalf?: LeaveHalf; endHalf?: LeaveHalf; holidays?: string[]; countWeekends?: boolean; weeklyOffs?: number[] } = {},
) =>
  countLeaveDays({
    start,
    end,
    startHalf: opts.startHalf ?? "full",
    endHalf: opts.endHalf ?? opts.startHalf ?? "full",
    weeklyOffs: opts.weeklyOffs ?? weekend,
    holidays: opts.holidays ?? [],
    countWeekends: opts.countWeekends ?? false,
  }).days;

describe("leave year", () => {
  it.each([
    ["2026-01-01", 1, 2026],
    ["2026-12-31", 1, 2026],
    ["2026-03-31", 4, 2025],
    ["2026-04-01", 4, 2026],
    ["2027-03-31", 4, 2026],
  ])("%s with start month %i belongs to leave year %i", (date, startMonth, year) => {
    expect(leaveYearOf(date, startMonth)).toBe(year);
  });

  it("gives the range and the month index inside the leave year", () => {
    expect(leaveYearRange(2026, 1)).toEqual({ start: "2026-01-01", end: "2026-12-31" });
    expect(leaveYearRange(2026, 4)).toEqual({ start: "2026-04-01", end: "2027-03-31" });
    expect(leaveYearRange(2027, 3)).toEqual({ start: "2027-03-01", end: "2028-02-29" });
    expect(leaveYearMonthIndex("2026-04-01", 4)).toBe(1);
    expect(leaveYearMonthIndex("2027-03-15", 4)).toBe(12);
    expect(leaveYearMonthIndex("2026-10-15", 1)).toBe(10);
  });
});

describe("half-day rounding", () => {
  it("rounds to the nearest half (ties up) and floors to a half", () => {
    expect([0.24, 0.25, 0.74, 0.75, 2.6].map(roundHalf)).toEqual([0, 0.5, 0.5, 1, 2.5]);
    expect([0.49, 0.5, 0.99, 2.6, 10].map(floorHalf)).toEqual([0, 0.5, 0.5, 2.5, 10]);
  });

  it("does not let floating point push an exact half below itself", () => {
    expect(floorHalf((7 * 6) / 12)).toBe(3.5);
    expect(floorHalf((10 * 3) / 12)).toBe(2.5);
  });
});

describe("accrual and pro-rating", () => {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  it("credits monthly in half days and sums to the annual quota", () => {
    const ten = months.map((k) => accrualCredit(10, k));
    expect(ten).toEqual([0.5, 1, 1, 0.5, 1, 1, 0.5, 1, 1, 0.5, 1, 1]);
    expect(ten.reduce((a, b) => a + b, 0)).toBe(10);
    expect(months.map((k) => accrualCredit(12, k))).toEqual(Array(12).fill(1));
    expect(months.map((k) => accrualCredit(18, k))).toEqual([1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5]);
    expect(months.map((k) => accrualCredit(7, k)).reduce((a, b) => a + b, 0)).toBe(7);
  });

  it("pro-rates an upfront quota by the months left, counting the joining month", () => {
    expect(proRatedQuota(12, 10)).toBe(3);
    expect(proRatedQuota(7, 7)).toBe(3.5);
    expect(proRatedQuota(6, 10)).toBe(1.5);
    expect(proRatedQuota(12, 1)).toBe(12);
  });
});

describe("countLeaveDays", () => {
  it("counts working days in a week", () => {
    expect(count("2026-11-02", "2026-11-06")).toBe(5);
  });

  it("skips weekends unless the type counts them", () => {
    expect(count("2026-11-06", "2026-11-09")).toBe(2);
    expect(count("2026-11-06", "2026-11-09", { countWeekends: true })).toBe(4);
    expect(count("2026-11-07", "2026-11-08")).toBe(0);
  });

  it("skips holidays that apply to the employee", () => {
    expect(count("2026-11-02", "2026-11-06", { holidays: ["2026-11-04"] })).toBe(4);
    expect(count("2026-11-02", "2026-11-06", { holidays: ["2026-11-04"], countWeekends: true })).toBe(5);
  });

  it("counts half days at the ends", () => {
    expect(count("2026-11-02", "2026-11-02", { startHalf: "first_half" })).toBe(0.5);
    expect(count("2026-11-02", "2026-11-04", { startHalf: "second_half", endHalf: "first_half" })).toBe(2);
    expect(count("2026-11-02", "2026-11-04", { startHalf: "second_half", endHalf: "full" })).toBe(2.5);
  });

  it("never subtracts a half from a day that does not count anyway", () => {
    expect(count("2026-11-07", "2026-11-09", { startHalf: "second_half", endHalf: "full" })).toBe(1);
  });

  it("explains each day", () => {
    const { breakdown } = countLeaveDays({
      start: "2026-11-06", end: "2026-11-09", startHalf: "second_half", endHalf: "full",
      weeklyOffs: weekend, holidays: new Set(["2026-11-09"]), countWeekends: false,
    });
    expect(breakdown).toEqual([
      { date: "2026-11-06", portion: "second_half", counted: 0.5, offReason: null },
      { date: "2026-11-07", portion: "full", counted: 0, offReason: "weekly_off" },
      { date: "2026-11-08", portion: "full", counted: 0, offReason: "weekly_off" },
      { date: "2026-11-09", portion: "full", counted: 0, offReason: "holiday" },
    ]);
  });

  it("rejects impossible input", () => {
    expect(() => count("2026-11-03", "2026-11-02")).toThrow(RangeError);
    expect(() => count("2026-11-02", "2026-11-03", { startHalf: "first_half", endHalf: "full" })).toThrow(RangeError);
  });

  describe("in an IST process", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("still treats 2026-01-01 as a Thursday", () => {
      vi.stubEnv("TZ", "Asia/Kolkata");
      // Thursday 1 Jan to Sunday 4 Jan: Thu + Fri.
      expect(count("2026-01-01", "2026-01-04")).toBe(2);
    });
  });
});

describe("overlap", () => {
  const portions = (start: string, end: string, startHalf: LeaveHalf = "full", endHalf: LeaveHalf = startHalf) =>
    requestPortions(start, end, startHalf, endHalf);

  it("maps a range to per-day portions", () => {
    expect([...portions("2026-11-02", "2026-11-04", "second_half", "first_half")]).toEqual([
      ["2026-11-02", "second_half"],
      ["2026-11-03", "full"],
      ["2026-11-04", "first_half"],
    ]);
  });

  it("lets a morning and an afternoon share a date", () => {
    expect(portionsOverlap(portions("2026-11-02", "2026-11-02", "first_half"), portions("2026-11-02", "2026-11-02", "second_half"))).toBe(false);
    expect(portionsOverlap(portions("2026-11-02", "2026-11-04", "full", "first_half"), portions("2026-11-04", "2026-11-05", "second_half", "full"))).toBe(false);
  });

  it("detects everything else that touches the same day", () => {
    expect(portionsOverlap(portions("2026-11-02", "2026-11-02"), portions("2026-11-02", "2026-11-02", "first_half"))).toBe(true);
    expect(portionsOverlap(portions("2026-11-02", "2026-11-02", "first_half"), portions("2026-11-02", "2026-11-02", "first_half"))).toBe(true);
    expect(portionsOverlap(portions("2026-11-02", "2026-11-05"), portions("2026-11-05", "2026-11-06"))).toBe(true);
    expect(portionsOverlap(portions("2026-11-02", "2026-11-03"), portions("2026-11-04", "2026-11-05"))).toBe(false);
  });
});
