import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import {
  employees, holidaySelections, holidays, holidayYearConfig, leaveLedger, leaveRequests, leaveTypes,
} from "@/server/db/schema";
import { createTestDb } from "../../helpers/db";
import { insertEmployee } from "../../helpers/employees";

function leaveType(db: DB, code = "CL") {
  return db.insert(leaveTypes).values({ code, name: `${code} leave`, color: "#2563eb" }).returning().get();
}

describe("leave schema", () => {
  it("creates the leave and holiday tables", () => {
    const db = createTestDb();
    const names = db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(["leave_types", "leave_ledger", "leave_requests", "holidays", "holiday_year_config", "holiday_selections"]),
    );
  });

  it("defaults a leave type to an unarchived paid upfront type and keeps codes unique", () => {
    const db = createTestDb();
    expect(leaveType(db)).toMatchObject({
      paid: true, isLop: false, accrual: "upfront", annualQuota: 0, carryForwardMax: 0, allowHalfDay: true,
      allowNegative: false, minNoticeDays: 0, countWeekends: false, isCompOff: false, archived: false,
      applicableEmploymentTypes: null, maxConsecutiveDays: null, attachmentAfterDays: null,
    });
    expect(() => leaveType(db)).toThrow(/UNIQUE/);
  });

  it("removes an employee's ledger, requests and holiday picks with the employee", () => {
    const db = createTestDb();
    const type = leaveType(db);
    const e = insertEmployee(db);
    const holiday = db.insert(holidays).values({ year: 2026, date: "2026-11-09", name: "Diwali", type: "optional" }).returning().get();
    db.insert(leaveLedger).values({ employeeId: e.id, leaveTypeId: type.id, year: 2026, date: "2026-01-01", delta: 12, kind: "grant" }).run();
    db.insert(leaveRequests)
      .values({ employeeId: e.id, leaveTypeId: type.id, startDate: "2026-11-02", endDate: "2026-11-02", days: 1 })
      .run();
    db.insert(holidaySelections).values({ employeeId: e.id, holidayId: holiday.id }).run();

    db.delete(employees).where(eq(employees.id, e.id)).run();
    expect(db.select().from(leaveLedger).all()).toEqual([]);
    expect(db.select().from(leaveRequests).all()).toEqual([]);
    expect(db.select().from(holidaySelections).all()).toEqual([]);
  });

  it("defaults a request to a pending full-day request", () => {
    const db = createTestDb();
    const type = leaveType(db);
    const e = insertEmployee(db);
    const request = db
      .insert(leaveRequests)
      .values({ employeeId: e.id, leaveTypeId: type.id, startDate: "2026-11-02", endDate: "2026-11-03", days: 2 })
      .returning()
      .get();
    expect(request).toMatchObject({ status: "pending", startHalf: "full", endHalf: "full", attachmentFileId: null });
  });

  it("allows one holiday per date and drops picks with their holiday", () => {
    const db = createTestDb();
    const e = insertEmployee(db);
    const holiday = db.insert(holidays).values({ year: 2026, date: "2026-11-09", name: "Diwali", type: "optional" }).returning().get();
    expect(() => db.insert(holidays).values({ year: 2026, date: "2026-11-09", name: "Again", type: "fixed" }).run()).toThrow(/UNIQUE/);
    db.insert(holidaySelections).values({ employeeId: e.id, holidayId: holiday.id }).run();
    expect(() => db.insert(holidaySelections).values({ employeeId: e.id, holidayId: holiday.id }).run()).toThrow(/UNIQUE|PRIMARY/);
    db.delete(holidays).where(eq(holidays.id, holiday.id)).run();
    expect(db.select().from(holidaySelections).all()).toEqual([]);
  });

  it("stores a per-year optional holiday allowance", () => {
    const db = createTestDb();
    db.insert(holidayYearConfig).values({ year: 2026, optionalAllowed: 2 }).run();
    expect(db.select().from(holidayYearConfig).get()).toMatchObject({ year: 2026, optionalAllowed: 2 });
  });
});
