import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  attendanceDays, attendancePunches, compOffClaims, compOffConsumptions, compOffLots, employees, regularizationRequests, shifts,
} from "@/server/db/schema";
import { createTestDb } from "../../helpers/db";
import { insertEmployee } from "../../helpers/employees";

describe("attendance schema", () => {
  it("creates the attendance and comp-off tables", () => {
    const db = createTestDb();
    const names = db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "shifts", "attendance_punches", "attendance_days", "regularization_requests", "comp_off_claims", "comp_off_lots",
        "comp_off_consumptions",
      ]),
    );
  });

  it("links employees to an optional shift that can't be deleted while in use", () => {
    const db = createTestDb();
    const shift = db
      .insert(shifts)
      .values({ name: "General", startTime: "09:30", endTime: "18:30", weeklyOffs: [0, 6] })
      .returning()
      .get();
    expect(shift).toMatchObject({ breakMinutes: 60, graceMinutes: 15, halfDayMinutes: 240, fullDayMinutes: 480, attendanceMode: "punch", archived: false });
    const e = insertEmployee(db, { shiftId: shift.id });
    expect(insertEmployee(db).shiftId).toBeNull();
    expect(() => db.delete(shifts).where(eq(shifts.id, shift.id)).run()).toThrow(/FOREIGN KEY/);
    expect(db.select().from(employees).where(eq(employees.id, e.id)).get()!.shiftId).toBe(shift.id);
  });

  it("keeps one attendance row per employee and date, and drops attendance with the employee", () => {
    const db = createTestDb();
    const e = insertEmployee(db);
    db.insert(attendanceDays).values({ employeeId: e.id, date: "2026-11-02", status: "present" }).run();
    expect(() => db.insert(attendanceDays).values({ employeeId: e.id, date: "2026-11-02", status: "absent" }).run()).toThrow(/UNIQUE|PRIMARY/);
    db.insert(attendancePunches).values({ employeeId: e.id, at: "2026-11-02T04:00:00.000Z", date: "2026-11-02", direction: "in" }).run();
    db.insert(regularizationRequests).values({ employeeId: e.id, date: "2026-11-02", requestedIn: 600, requestedOut: 1110, reason: "Forgot" }).run();
    db.delete(employees).where(eq(employees.id, e.id)).run();
    expect([db.select().from(attendanceDays).all(), db.select().from(attendancePunches).all(), db.select().from(regularizationRequests).all()]).toEqual([[], [], []]);
  });

  it("allows one active comp-off claim per worked date", () => {
    const db = createTestDb();
    const e = insertEmployee(db);
    const claim = (status: "pending" | "approved" | "rejected") =>
      db.insert(compOffClaims).values({ employeeId: e.id, workedDate: "2026-11-07", workedMinutes: 510, daysRequested: 1, status }).run();
    claim("rejected");
    claim("pending");
    expect(() => claim("approved")).toThrow(/UNIQUE/);
  });

  it("tracks lots and what consumed them", () => {
    const db = createTestDb();
    const e = insertEmployee(db);
    const lot = db
      .insert(compOffLots)
      .values({ employeeId: e.id, days: 1, remaining: 1, earnedOn: "2026-11-07", expiresOn: "2027-02-05" })
      .returning()
      .get();
    expect(lot).toMatchObject({ status: "active", claimId: null });
    db.insert(compOffConsumptions).values({ lotId: lot.id, leaveRequestId: 1, days: 0.5 }).run();
    expect(db.select().from(compOffConsumptions).get()).toMatchObject({ lotId: lot.id, days: 0.5 });
  });
});
