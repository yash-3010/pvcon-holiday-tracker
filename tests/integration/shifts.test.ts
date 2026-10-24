import { beforeEach, describe, expect, it } from "vitest";
import type { ShiftInput } from "@/lib/validation/attendance";
import type { DB } from "@/server/db/client";
import { companyWeeklyOffs, weeklyOffsForEmployee } from "@/server/modules/attendance/calendar";
import {
  assignShift, createShift, defaultShift, listShifts, seedDefaultShift, setShiftArchived, shiftForEmployee, shiftRules, updateShift,
} from "@/server/modules/attendance/shifts";
import { getSetting, patchSetting } from "@/server/modules/settings/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError } from "../helpers/fixtures";

let db: DB;
beforeEach(() => {
  db = createTestDb();
});

const night: ShiftInput = {
  name: "Early", startTime: "07:00", endTime: "16:00", breakMinutes: 60, graceMinutes: 10, halfDayMinutes: 240,
  fullDayMinutes: 480, weeklyOffs: [0], attendanceMode: "punch", autoClockOutTime: "20:00",
};

describe("default shift", () => {
  it("is virtual until seeded, using the company weekly offs and mode", () => {
    patchSetting(db, "attendance", { weeklyOffs: [5, 6], defaultMode: "auto" }, null);
    expect(defaultShift(db)).toMatchObject({ id: 0, name: "General", weeklyOffs: [5, 6], attendanceMode: "auto" });
    expect(companyWeeklyOffs(db)).toEqual([5, 6]);
  });

  it("is seeded once as General 09:30–18:30 and becomes the setting", () => {
    const seeded = seedDefaultShift(db);
    expect(seeded).toMatchObject({ name: "General", startTime: "09:30", endTime: "18:30", weeklyOffs: [0, 6], autoClockOutTime: "23:30" });
    expect(seedDefaultShift(db).id).toBe(seeded.id);
    expect(getSetting(db, "attendance").defaultShiftId).toBe(seeded.id);
    expect(defaultShift(db).id).toBe(seeded.id);
  });

  it("can be seeded in auto mode for migrated data", () => {
    expect(seedDefaultShift(db, { attendanceMode: "auto" }).attendanceMode).toBe("auto");
  });
});

describe("shifts", () => {
  it("creates, updates and lists shifts with their employees", () => {
    const general = seedDefaultShift(db);
    const early = createShift(db, night);
    const e = insertEmployee(db, { shiftId: early.id });
    insertEmployee(db);
    expect(shiftForEmployee(db, e.id).id).toBe(early.id);
    expect(weeklyOffsForEmployee(db, e.id)).toEqual([0]);
    expect(listShifts(db).map((s) => [s.name, s.employees, s.isDefault])).toEqual([
      ["Early", 1, false],
      ["General", 1, true],
    ]);
    const { after } = updateShift(db, early.id, { ...night, weeklyOffs: [0, 6] });
    expect(after.weeklyOffs).toEqual([0, 6]);
    expectDomainError(() => createShift(db, { ...night, name: "general" }), "DUPLICATE_NAME");
    expect(general.id).not.toBe(early.id);
  });

  it("guards archiving the default shift and shifts in use", () => {
    const general = seedDefaultShift(db);
    const early = createShift(db, night);
    const e = insertEmployee(db, { shiftId: early.id });
    expectDomainError(() => setShiftArchived(db, general.id, true), "DEFAULT_SHIFT");
    expectDomainError(() => setShiftArchived(db, early.id, true), "SHIFT_IN_USE");
    assignShift(db, [e.id], null);
    expect(shiftForEmployee(db, e.id).id).toBe(general.id);
    expect(setShiftArchived(db, early.id, true).archived).toBe(true);
    expectDomainError(() => assignShift(db, [e.id], early.id), "ARCHIVED");
  });

  it("turns a shift into computation rules", () => {
    expect(shiftRules(seedDefaultShift(db))).toEqual({
      startMinutes: 570, endMinutes: 1110, graceMinutes: 15, halfDayMinutes: 240, fullDayMinutes: 480, weeklyOffs: [0, 6], mode: "punch",
    });
  });
});
