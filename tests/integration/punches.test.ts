import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { attendanceDays, attendancePunches, employees, type EmployeeRow } from "@/server/db/schema";
import { autoClockOut, clockIn, clockOut, clockState } from "@/server/modules/attendance/punches";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError } from "../helpers/fixtures";

let db: DB;
let asha: EmployeeRow;
const at = (iso: string) => new Date(iso);
const punches = () =>
  db.select({ at: attendancePunches.at, date: attendancePunches.date, direction: attendancePunches.direction, source: attendancePunches.source })
    .from(attendancePunches)
    .orderBy(asc(attendancePunches.at))
    .all();

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  asha = insertEmployee(db, { dateOfJoining: "2025-01-01" });
});

describe("clock in and out", () => {
  it("tracks state and adds up several sessions in a day", () => {
    expect(clockState(db, asha.id, at("2026-11-02T03:00:00Z"))).toMatchObject({ state: "out", since: null, todayWorkedMinutes: 0, date: "2026-11-02" });
    clockIn(db, asha.id, { workMode: "office", ip: "10.0.0.1", now: at("2026-11-02T04:00:00Z") });
    expect(clockState(db, asha.id, at("2026-11-02T05:00:00Z"))).toMatchObject({
      state: "in", since: "2026-11-02T04:00:00.000Z", workMode: "office", todayWorkedMinutes: 60,
    });
    clockOut(db, asha.id, { ip: "10.0.0.1", now: at("2026-11-02T07:30:00Z") });
    clockIn(db, asha.id, { workMode: "remote", ip: null, now: at("2026-11-02T08:30:00Z") });
    clockOut(db, asha.id, { ip: null, now: at("2026-11-02T13:30:00Z") });
    expect(clockState(db, asha.id, at("2026-11-02T14:00:00Z"))).toMatchObject({ state: "out", todayWorkedMinutes: 210 + 300 });
    expect(db.select().from(attendanceDays).get()).toMatchObject({ date: "2026-11-02", status: "present", workedMinutes: 510 });
    expect(punches().map((p) => p.source)).toEqual(["web", "web", "web", "web"]);
  });

  it("refuses a second clock-in and a clock-out with nothing open", () => {
    expectDomainError(() => clockOut(db, asha.id, { ip: null, now: at("2026-11-02T04:00:00Z") }), "NOT_IN");
    clockIn(db, asha.id, { workMode: "office", ip: null, now: at("2026-11-02T04:00:00Z") });
    expectDomainError(() => clockIn(db, asha.id, { workMode: "office", ip: null, now: at("2026-11-02T05:00:00Z") }), "ALREADY_IN");
  });

  it("dates a punch by the company time zone", () => {
    clockIn(db, asha.id, { workMode: "office", ip: null, now: at("2026-11-02T18:40:00Z") });
    expect(punches()[0]).toMatchObject({ date: "2026-11-03", direction: "in" });
  });

  it("refuses people who are not working", () => {
    const joiner = insertEmployee(db, { dateOfJoining: "2026-12-01" });
    expectDomainError(() => clockIn(db, joiner.id, { workMode: "office", ip: null, now: at("2026-11-02T04:00:00Z") }), "NOT_WORKING");
    db.update(employees).set({ status: "exited" }).where(eq(employees.id, asha.id)).run();
    expectDomainError(() => clockIn(db, asha.id, { workMode: "office", ip: null, now: at("2026-11-02T04:00:00Z") }), "NOT_WORKING");
  });
});

describe("automatic clock-out", () => {
  it("closes open sessions at the shift's auto clock-out time", () => {
    clockIn(db, asha.id, { workMode: "office", ip: null, now: at("2026-11-02T04:00:00Z") });
    // 00:30 IST on 3 Nov closes 2 Nov at 23:30 IST (18:00Z).
    expect(autoClockOut(db, "2026-11-02", at("2026-11-02T19:00:00Z"))).toBe(1);
    expect(punches()[1]).toMatchObject({ at: "2026-11-02T18:00:00.000Z", direction: "out", source: "auto" });
    expect(autoClockOut(db, "2026-11-02", at("2026-11-02T19:00:00Z"))).toBe(0);
  });

  it("closes a forgotten session before a new day's clock-in", () => {
    clockIn(db, asha.id, { workMode: "office", ip: null, now: at("2026-11-02T04:00:00Z") });
    clockIn(db, asha.id, { workMode: "office", ip: null, now: at("2026-11-03T04:00:00Z") });
    expect(punches().map((p) => [p.date, p.direction, p.source])).toEqual([
      ["2026-11-02", "in", "web"],
      ["2026-11-02", "out", "auto"],
      ["2026-11-03", "in", "web"],
    ]);
  });
});
