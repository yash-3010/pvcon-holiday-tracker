import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { attendanceDays, attendancePunches, notifications } from "@/server/db/schema";
import { runJobByName } from "@/server/jobs/registry";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { patchSetting } from "@/server/modules/settings/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser } from "../helpers/fixtures";

let db: DB;
const punch = (employeeId: number, at: string, direction: "in" | "out") =>
  db.insert(attendancePunches).values({ employeeId, at, date: "2026-11-07", direction }).run();
// 19:00 UTC on Saturday 7 Nov is 00:30 IST on Sunday 8 Nov.
const AT = new Date("2026-11-07T19:00:00Z");

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
});

describe("attendance:close-day", () => {
  it("closes yesterday: auto clock-out, recompute and comp-off prompts, once", () => {
    const asha = insertEmployee(db, { dateOfJoining: "2025-01-01", userId: insertUser(db).id });
    const ravi = insertEmployee(db, { dateOfJoining: "2025-01-01", userId: insertUser(db).id });
    const kiran = insertEmployee(db, { dateOfJoining: "2025-01-01", userId: insertUser(db).id });
    punch(asha.id, "2026-11-07T04:30:00.000Z", "in");
    punch(asha.id, "2026-11-07T13:00:00.000Z", "out");
    punch(ravi.id, "2026-11-07T05:00:00.000Z", "in");
    punch(kiran.id, "2026-11-07T05:00:00.000Z", "in");
    punch(kiran.id, "2026-11-07T07:00:00.000Z", "out");

    expect(runJobByName(db, "attendance:close-day", AT)).toEqual({
      status: "succeeded",
      detail: "Closed 2026-11-07: 1 automatic clock-out(s), 3 day(s) computed, 2 comp-off prompt(s)",
    });
    const asSaturday = (id: number) => db.select().from(attendanceDays).where(eq(attendanceDays.employeeId, id)).get();
    expect(asSaturday(asha.id)).toMatchObject({ status: "weekly_off", offDayWorked: true, workedMinutes: 510 });
    // Ravi was clocked out automatically at 23:30 IST: 10:30 → 23:30.
    expect(asSaturday(ravi.id)).toMatchObject({ offDayWorked: true, workedMinutes: 780 });
    const prompts = db.select().from(notifications).where(eq(notifications.type, "compoff.eligible")).all();
    expect(prompts.map((n) => n.userId).sort()).toEqual([asha.userId, ravi.userId].sort());
    expect(prompts[0]!.link).toBe("/me/attendance?month=2026-11");
    expect(runJobByName(db, "attendance:close-day", AT).status).toBe("skipped");
  });

  it("sends no prompts when comp-off is off", () => {
    patchSetting(db, "compOff", { enabled: false }, null);
    const asha = insertEmployee(db, { dateOfJoining: "2025-01-01", userId: insertUser(db).id });
    punch(asha.id, "2026-11-07T04:30:00.000Z", "in");
    punch(asha.id, "2026-11-07T13:00:00.000Z", "out");
    expect(runJobByName(db, "attendance:close-day", AT).detail).toContain("0 comp-off prompt(s)");
  });
});
