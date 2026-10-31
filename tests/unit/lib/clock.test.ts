import { describe, expect, it } from "vitest";
import { clockTabTitle, dayClock, formatStopwatch, type ClockPunch } from "@/lib/clock";

// Times are UTC instants; 04:00Z is 09:30 in Pune.
const at = (hhmm: string) => `2026-10-29T${hhmm}:00.000Z`;
const p = (hhmm: string, direction: "in" | "out", startsBreak = false): ClockPunch => ({ at: at(hhmm), direction, startsBreak });
const now = (hhmm: string) => new Date(at(hhmm));

describe("day clock", () => {
  it("is idle before the first clock-in", () => {
    expect(dayClock([], now("04:00"))).toEqual({
      state: "idle", workedSeconds: 0, breakSeconds: 0, sessionStartedAt: null, breakStartedAt: null, firstInAt: null, endedAt: null,
    });
  });

  it("counts the open session up to now while working", () => {
    expect(dayClock([p("04:00", "in")], now("06:30"))).toMatchObject({
      state: "working", workedSeconds: 2.5 * 3600, sessionStartedAt: at("04:00"), firstInAt: at("04:00"),
    });
  });

  it("pauses the worked time during a break and counts the break instead", () => {
    const punches = [p("04:00", "in"), p("07:30", "out", true)];
    expect(dayClock(punches, now("07:50"))).toMatchObject({
      state: "break", workedSeconds: 3.5 * 3600, breakSeconds: 20 * 60, breakStartedAt: at("07:30"), sessionStartedAt: null,
    });
  });

  it("adds up sessions and breaks across the day, then stops when the day ends", () => {
    const punches = [p("04:00", "in"), p("07:30", "out", true), p("08:15", "in"), p("10:00", "out", true), p("10:10", "in")];
    expect(dayClock(punches, now("13:00"))).toMatchObject({
      // 3h 30m + 1h 45m + 2h 50m worked; 45m + 10m of breaks.
      state: "working", workedSeconds: 29_100, breakSeconds: 55 * 60, sessionStartedAt: at("10:10"),
    });
    const ended = [...punches, p("13:00", "out")];
    expect(dayClock(ended, now("15:00"))).toMatchObject({ state: "done", workedSeconds: 29_100, endedAt: at("13:00") });
  });

  it("ignores an out with nothing open and a second in while one is open, like attendance does", () => {
    const punches = [p("03:00", "out"), p("04:00", "in"), p("04:30", "in"), p("05:00", "out")];
    expect(dayClock(punches, now("06:00"))).toMatchObject({ state: "done", workedSeconds: 3600, firstInAt: at("04:00") });
  });

  it("sorts punches by time whatever order they arrive in", () => {
    expect(dayClock([p("05:00", "out"), p("04:00", "in")], now("06:00"))).toMatchObject({ state: "done", workedSeconds: 3600 });
  });
});

describe("stopwatch", () => {
  it("shows hours, minutes and seconds", () => {
    expect(formatStopwatch(0)).toBe("0:00:00");
    expect(formatStopwatch(3 * 3600 + 12 * 60 + 45)).toBe("3:12:45");
    expect(formatStopwatch(59.9)).toBe("0:00:59");
    expect(formatStopwatch(-5)).toBe("0:00:00");
  });
});

describe("tab title", () => {
  it("leads with the running time, then the page's own title", () => {
    expect(clockTabTitle("Dashboard · PVCON People", "working", 3 * 3600 + 12 * 60 + 45)).toBe("3:12:45 · Dashboard · PVCON People");
    expect(clockTabTitle("My leave · PVCON People", "break", 12 * 60 + 3)).toBe("Break 0:12:03 · My leave · PVCON People");
  });

  it("replaces its own earlier reading and leaves the page title alone when the clock stops", () => {
    expect(clockTabTitle("3:12:45 · Dashboard · PVCON People", "working", 3 * 3600 + 12 * 60 + 46)).toBe("3:12:46 · Dashboard · PVCON People");
    expect(clockTabTitle("3:12:46 · Dashboard · PVCON People", "break", 1)).toBe("Break 0:00:01 · Dashboard · PVCON People");
    expect(clockTabTitle("Break 0:00:09 · Dashboard · PVCON People", "done", 0)).toBe("Dashboard · PVCON People");
    expect(clockTabTitle("Dashboard · PVCON People", "idle", 0)).toBe("Dashboard · PVCON People");
  });
});
