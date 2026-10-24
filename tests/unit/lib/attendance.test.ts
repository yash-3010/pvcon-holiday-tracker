import { describe, expect, it } from "vitest";
import { compOffDaysFor, computeAttendanceDay, pairPunches, type AttendanceDayInput } from "@/lib/attendance";

const shift = {
  startMinutes: 570, // 09:30
  endMinutes: 1110, // 18:30
  graceMinutes: 15,
  halfDayMinutes: 240,
  fullDayMinutes: 480,
  weeklyOffs: [0, 6],
  mode: "punch" as const,
};

// Monday 2 Nov 2026.
function day(overrides: Partial<AttendanceDayInput> = {}): AttendanceDayInput {
  return {
    date: "2026-11-02", weekday: 1, dateOfJoining: "2025-01-01", lastWorkingDate: null, shift, holiday: null, leave: [],
    sessions: [], nowMinutes: null, override: null, ...overrides,
  };
}
const worked = (inMinutes: number, outMinutes: number | null) => [{ inMinutes, outMinutes }];

describe("pairPunches", () => {
  it("pairs ins and outs in time order and ignores strays", () => {
    expect(
      pairPunches([
        { minutes: 780, direction: "in" },
        { minutes: 560, direction: "in" },
        { minutes: 720, direction: "out" },
        { minutes: 600, direction: "in" },
        { minutes: 500, direction: "out" },
        { minutes: 1100, direction: "out" },
        { minutes: 1105, direction: "out" },
      ]),
    ).toEqual([
      { inMinutes: 560, outMinutes: 720 },
      { inMinutes: 780, outMinutes: 1100 },
    ]);
    expect(pairPunches([{ minutes: 560, direction: "in" }])).toEqual([{ inMinutes: 560, outMinutes: null }]);
  });
});

describe("computeAttendanceDay", () => {
  it("marks days outside employment", () => {
    expect(computeAttendanceDay(day({ dateOfJoining: "2026-11-03" })).status).toBe("not_joined");
    expect(computeAttendanceDay(day({ lastWorkingDate: "2026-11-01" })).status).toBe("exited");
  });

  it("lets an admin override win, even over leave", () => {
    const result = computeAttendanceDay(day({ override: "present", leave: [{ portion: "full", requestId: 7 }] }));
    expect(result).toMatchObject({ status: "present", leaveRequestId: 7 });
  });

  it("puts full-day leave, or two half days, before everything else", () => {
    expect(computeAttendanceDay(day({ leave: [{ portion: "full", requestId: 7 }], holiday: "Diwali" }))).toMatchObject({
      status: "on_leave", leaveRequestId: 7,
    });
    expect(
      computeAttendanceDay(day({ leave: [{ portion: "first_half", requestId: 7 }, { portion: "second_half", requestId: 8 }] })).status,
    ).toBe("on_leave");
  });

  it("marks holidays and weekly offs, flagging work done on them", () => {
    expect(computeAttendanceDay(day({ holiday: "Diwali" }))).toMatchObject({ status: "holiday", offDayWorked: false });
    const saturday = computeAttendanceDay(day({ date: "2026-11-07", weekday: 6, sessions: worked(600, 1110) }));
    expect(saturday).toMatchObject({ status: "weekly_off", offDayWorked: true, workedMinutes: 510, overtimeMinutes: 510, lateMinutes: 0 });
  });

  it("keeps a half-day leave as half leave with the worked half", () => {
    expect(computeAttendanceDay(day({ leave: [{ portion: "first_half", requestId: 9 }], sessions: worked(840, 1110) }))).toMatchObject({
      status: "half_leave", workedMinutes: 270, leaveRequestId: 9,
    });
  });

  it("does not count the half covered by leave as late or early", () => {
    expect(computeAttendanceDay(day({ leave: [{ portion: "first_half", requestId: 9 }], sessions: worked(840, 1110) })).lateMinutes).toBe(0);
    expect(computeAttendanceDay(day({ leave: [{ portion: "second_half", requestId: 9 }], sessions: worked(570, 840) })).earlyMinutes).toBe(0);
  });

  it("counts an auto-mode working day as present without punches", () => {
    expect(computeAttendanceDay(day({ shift: { ...shift, mode: "auto" } })).status).toBe("present");
  });

  it("grades worked time against the shift", () => {
    expect(computeAttendanceDay(day({ sessions: worked(570, 1110) }))).toMatchObject({ status: "present", workedMinutes: 540, overtimeMinutes: 60 });
    expect(computeAttendanceDay(day({ sessions: worked(570, 870) }))).toMatchObject({ status: "half_day", earlyMinutes: 240 });
    expect(computeAttendanceDay(day({ sessions: worked(570, 700) })).status).toBe("absent");
    expect(computeAttendanceDay(day()).status).toBe("absent");
  });

  it("measures lateness after the grace period only", () => {
    expect(computeAttendanceDay(day({ sessions: worked(585, 1110) })).lateMinutes).toBe(0);
    expect(computeAttendanceDay(day({ sessions: worked(600, 1110) }))).toMatchObject({ lateMinutes: 15, firstIn: 600, lastOut: 1110 });
  });

  it("sums several sessions and counts an open session up to now", () => {
    const result = computeAttendanceDay(day({ sessions: [{ inMinutes: 570, outMinutes: 780 }, { inMinutes: 840, outMinutes: null }], nowMinutes: 1000 }));
    expect(result).toMatchObject({ workedMinutes: 210 + 160, lastOut: null });
    expect(computeAttendanceDay(day({ sessions: [{ inMinutes: 570, outMinutes: null }] })).workedMinutes).toBe(0);
  });
});

describe("compOffDaysFor", () => {
  it("credits a full or half day by threshold", () => {
    const thresholds = { half: 240, full: 480 };
    expect([510, 480, 300, 240, 239].map((m) => compOffDaysFor(m, thresholds))).toEqual([1, 1, 0.5, 0.5, 0]);
  });
});
