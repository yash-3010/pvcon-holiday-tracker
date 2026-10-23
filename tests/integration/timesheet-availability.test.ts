import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { leaveRequests } from "@/server/db/schema";
import { createShift, seedDefaultShift } from "@/server/modules/attendance/shifts";
import { createHoliday } from "@/server/modules/holidays/service";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { availableMinutes, workCalendar } from "@/server/modules/timesheets/availability";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";

let db: DB;
// Monday 19 Oct 2026.
const MON = "2026-10-19";
const SUN = "2026-10-25";

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  seedDefaultLeaveTypes(db);
});

describe("work calendar", () => {
  it("offers the shift's hours less the break on each working day", () => {
    const e = insertEmployee(db, { dateOfJoining: "2025-01-01" });
    const days = workCalendar(db, e.id, MON, SUN);
    expect(days.map((d) => [d.kind, d.availableMinutes])).toEqual([
      ["working", 480], ["working", 480], ["working", 480], ["working", 480], ["working", 480], ["weekly_off", 0], ["weekly_off", 0],
    ]);
    expect(availableMinutes(db, e.id, MON, SUN)).toBe(2400);
  });

  it("takes holidays and leave off, half a day for a half-day leave", () => {
    const e = insertEmployee(db, { dateOfJoining: "2025-01-01" });
    createHoliday(db, { date: "2026-10-20", name: "Dussehra", type: "fixed" });
    const cl = listLeaveTypes(db).find((t) => t.code === "CL")!;
    const leave = { employeeId: e.id, leaveTypeId: cl.id, status: "approved" as const, appliedBy: null };
    db.insert(leaveRequests).values([
      { ...leave, startDate: "2026-10-21", endDate: "2026-10-21", startHalf: "full", endHalf: "full", days: 1 },
      { ...leave, startDate: "2026-10-22", endDate: "2026-10-22", startHalf: "second_half", endHalf: "second_half", days: 0.5 },
      { ...leave, startDate: "2026-10-23", endDate: "2026-10-23", startHalf: "first_half", endHalf: "first_half", days: 0.5, status: "pending" },
    ]).run();
    const days = workCalendar(db, e.id, MON, SUN);
    expect(days.slice(1, 5)).toMatchObject([
      { kind: "holiday", holiday: "Dussehra", availableMinutes: 0 },
      { kind: "leave", leave: { code: "CL", portion: "full" }, availableMinutes: 0 },
      { kind: "half_leave", leave: { code: "CL", portion: "second_half" }, availableMinutes: 240 },
      { kind: "working", leave: null, availableMinutes: 480 },
    ]);
    expect(availableMinutes(db, e.id, MON, SUN)).toBe(480 + 240 + 480);
  });

  it("follows the employee's shift and employment dates", () => {
    const sixDay = createShift(db, {
      name: "Six day", startTime: "09:00", endTime: "17:00", breakMinutes: 30, graceMinutes: 10, halfDayMinutes: 210,
      fullDayMinutes: 420, weeklyOffs: [0], attendanceMode: "punch", autoClockOutTime: null,
    });
    const e = insertEmployee(db, { dateOfJoining: "2026-10-21", shiftId: sixDay.id });
    expect(workCalendar(db, e.id, MON, SUN).map((d) => [d.kind, d.availableMinutes])).toEqual([
      ["not_employed", 0], ["not_employed", 0], ["working", 450], ["working", 450], ["working", 450], ["working", 450], ["weekly_off", 0],
    ]);
  });
});
