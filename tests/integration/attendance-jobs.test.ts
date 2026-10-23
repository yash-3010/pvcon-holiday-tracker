import { and, eq } from "drizzle-orm";
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
      // The 34 days before yesterday had never been computed, so the job fills them too.
      detail: "Closed 2026-11-07: 1 automatic clock-out(s), 3 day(s) computed, 102 missing earlier day(s) filled, 2 comp-off prompt(s)",
    });
    const asSaturday = (id: number) =>
      db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, id), eq(attendanceDays.date, "2026-11-07"))).get();
    expect(asSaturday(asha.id)).toMatchObject({ status: "weekly_off", offDayWorked: true, workedMinutes: 510 });
    // Ravi was clocked out automatically at 23:30 IST: 10:30 → 23:30.
    expect(asSaturday(ravi.id)).toMatchObject({ offDayWorked: true, workedMinutes: 780 });
    const prompts = db.select().from(notifications).where(eq(notifications.type, "compoff.eligible")).all();
    expect(prompts.map((n) => n.userId).sort()).toEqual([asha.userId, ravi.userId].sort());
    expect(prompts[0]!.link).toBe("/me/attendance?month=2026-11");
    expect(runJobByName(db, "attendance:close-day", AT).status).toBe("skipped");
  });

  it("fills earlier days nobody computed, leaving computed and locked ones alone", () => {
    const late = insertEmployee(db, { dateOfJoining: "2026-10-20" });
    const future = insertEmployee(db, { dateOfJoining: "2026-11-09" });
    db.insert(attendanceDays).values({ employeeId: late.id, date: "2026-11-02", status: "present", workedMinutes: 540, locked: true }).run();
    expect(runJobByName(db, "attendance:close-day", AT).detail).toContain("17 missing earlier day(s) filled");
    const rows = db.select().from(attendanceDays).where(eq(attendanceDays.employeeId, late.id)).all();
    expect(rows.map((r) => r.date).sort()).toEqual(
      Array.from({ length: 19 }, (_, i) => new Date(Date.UTC(2026, 9, 20 + i)).toISOString().slice(0, 10)),
    );
    expect(rows.find((r) => r.date === "2026-11-02")).toMatchObject({ status: "present", locked: true });
    expect(rows.find((r) => r.date === "2026-11-02")!.workedMinutes).toBe(540);
    expect(db.select().from(attendanceDays).where(eq(attendanceDays.employeeId, future.id)).all()).toEqual([]);
  });

  it("sends no prompts when comp-off is off", () => {
    patchSetting(db, "compOff", { enabled: false }, null);
    const asha = insertEmployee(db, { dateOfJoining: "2025-01-01", userId: insertUser(db).id });
    punch(asha.id, "2026-11-07T04:30:00.000Z", "in");
    punch(asha.id, "2026-11-07T13:00:00.000Z", "out");
    expect(runJobByName(db, "attendance:close-day", AT).detail).toContain("0 comp-off prompt(s)");
  });
});
