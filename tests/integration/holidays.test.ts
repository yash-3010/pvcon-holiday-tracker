import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/server/db/client";
import { holidays, holidaySelections } from "@/server/db/schema";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError } from "../helpers/fixtures";

const hooks = vi.hoisted(() => ({ onHolidayChanged: vi.fn(), onLeaveChanged: vi.fn() }));
vi.mock("@/server/modules/attendance/hooks", () => hooks);

import {
  copyHolidaysFromYear, createHoliday, deleteHoliday, getYearConfig, holidayDatesForEmployee, holidaysForEmployee,
  importHolidaysCsv, listHolidays, optionalPicksFor, optionalUsed, selectOptionalHoliday, setYearConfig, updateHoliday,
} from "@/server/modules/holidays/service";

let db: DB;
beforeEach(() => {
  db = createTestDb();
  hooks.onHolidayChanged.mockClear();
});

describe("holiday calendar", () => {
  it("creates, lists, updates and deletes holidays, telling attendance about each date", () => {
    const republic = createHoliday(db, { date: "2026-01-26", name: "Republic Day", type: "fixed" });
    const holi = createHoliday(db, { date: "2026-03-04", name: "Holi", type: "optional" });
    expect(republic.year).toBe(2026);
    expect(listHolidays(db, 2026).map((h) => h.name)).toEqual(["Republic Day", "Holi"]);
    expectDomainError(() => createHoliday(db, { date: "2026-01-26", name: "Again", type: "fixed" }), "DATE_TAKEN");

    const { before, after } = updateHoliday(db, holi.id, { date: "2026-03-05", name: "Holi", type: "optional" });
    expect([before.date, after.date]).toEqual(["2026-03-04", "2026-03-05"]);
    expectDomainError(() => updateHoliday(db, holi.id, { date: "2026-01-26", name: "Holi", type: "optional" }), "DATE_TAKEN");
    deleteHoliday(db, republic.id);
    expect(listHolidays(db, 2026).map((h) => h.name)).toEqual(["Holi"]);
    expect(hooks.onHolidayChanged.mock.calls.map((c) => c[1])).toEqual(["2026-01-26", "2026-03-04", "2026-03-04", "2026-03-05", "2026-01-26"]);
    expectDomainError(() => deleteHoliday(db, 999), "NOT_FOUND");
  });

  it("stores the optional allowance per year, defaulting to none", () => {
    expect(getYearConfig(db, 2026)).toEqual({ year: 2026, optionalAllowed: 0 });
    setYearConfig(db, 2026, 2);
    setYearConfig(db, 2026, 3);
    expect(getYearConfig(db, 2026)).toEqual({ year: 2026, optionalAllowed: 3 });
  });
});

describe("optional holidays", () => {
  function setup() {
    const e = insertEmployee(db);
    setYearConfig(db, 2026, 1);
    const diwali = createHoliday(db, { date: "2026-11-09", name: "Diwali", type: "optional" });
    const christmas = createHoliday(db, { date: "2026-12-25", name: "Christmas", type: "optional" });
    const independence = createHoliday(db, { date: "2026-08-15", name: "Independence Day", type: "fixed" });
    return { e, diwali, christmas, independence };
  }

  it("lets an employee pick up to the allowance and unpick before the date", () => {
    const { e, diwali, christmas } = setup();
    selectOptionalHoliday(db, e.id, diwali.id, true, "2026-10-01");
    selectOptionalHoliday(db, e.id, diwali.id, true, "2026-10-01");
    expect(optionalUsed(db, e.id, 2026)).toBe(1);
    expectDomainError(() => selectOptionalHoliday(db, e.id, christmas.id, true, "2026-10-01"), "OPTIONAL_LIMIT");
    selectOptionalHoliday(db, e.id, diwali.id, false, "2026-10-01");
    selectOptionalHoliday(db, e.id, christmas.id, true, "2026-10-01");
    expect(optionalPicksFor(db, e.id, 2026, "2026-10-01")).toEqual([
      { holidayId: diwali.id, date: "2026-11-09", name: "Diwali", selected: false, locked: false },
      { holidayId: christmas.id, date: "2026-12-25", name: "Christmas", selected: true, locked: false },
    ]);
  });

  it("locks picks once the date has passed and refuses fixed holidays", () => {
    const { e, diwali, independence } = setup();
    selectOptionalHoliday(db, e.id, diwali.id, true, "2026-11-01");
    expectDomainError(() => selectOptionalHoliday(db, e.id, diwali.id, false, "2026-11-10"), "HOLIDAY_PASSED");
    expectDomainError(() => selectOptionalHoliday(db, e.id, independence.id, true, "2026-08-01"), "NOT_OPTIONAL");
    expect(optionalPicksFor(db, e.id, 2026, "2026-11-10")[0]).toMatchObject({ selected: true, locked: true });
  });

  it("treats picked optional holidays like fixed ones for that employee only", () => {
    const { e, diwali } = setup();
    const other = insertEmployee(db);
    selectOptionalHoliday(db, e.id, diwali.id, true, "2026-10-01");
    expect(holidaysForEmployee(db, e.id, "2026-08-01", "2026-12-31").map((h) => h.name)).toEqual(["Independence Day", "Diwali"]);
    expect([...holidayDatesForEmployee(db, other.id, "2026-08-01", "2026-12-31")]).toEqual(["2026-08-15"]);
  });

  it("drops picks when an optional holiday becomes fixed", () => {
    const { e, diwali } = setup();
    selectOptionalHoliday(db, e.id, diwali.id, true, "2026-10-01");
    updateHoliday(db, diwali.id, { date: "2026-11-09", name: "Diwali", type: "fixed" });
    expect(db.select().from(holidaySelections).all()).toEqual([]);
  });
});

describe("CSV import", () => {
  it("imports a spreadsheet export with a BOM, CRLF and loose headers", () => {
    const csv = "﻿ Date ,NAME,Type\r\n2026-01-26,Republic Day,\r\n2026-11-09,Diwali,Optional\r\n\r\n";
    expect(importHolidaysCsv(db, csv)).toEqual({ created: 2, errors: [] });
    expect(listHolidays(db, 2026).map((h) => [h.date, h.type])).toEqual([["2026-01-26", "fixed"], ["2026-11-09", "optional"]]);
  });

  it("imports nothing when any row is wrong", () => {
    createHoliday(db, { date: "2026-08-15", name: "Independence Day", type: "fixed" });
    const csv = "date,name,type\n2026-01-26,Republic Day,fixed\n2026-02-30,Bad,fixed\n2026-08-15,Again,fixed\n2026-01-26,Twice,fixed\n2026-03-04,,fixed\n";
    const result = importHolidaysCsv(db, csv);
    expect(result.created).toBe(0);
    expect(result.errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
    expect(listHolidays(db, 2026)).toHaveLength(1);
  });

  it("reports a missing column", () => {
    expect(importHolidaysCsv(db, "day,name\n2026-01-26,Republic Day\n").errors).toEqual([{ row: 0, message: "Missing column(s): date" }]);
  });
});

describe("copying a year", () => {
  it("copies month and day, skipping 29 February and dates already there", () => {
    createHoliday(db, { date: "2028-02-29", name: "Leap", type: "fixed" });
    createHoliday(db, { date: "2028-01-26", name: "Republic Day", type: "fixed" });
    createHoliday(db, { date: "2028-11-09", name: "Diwali", type: "optional" });
    setYearConfig(db, 2028, 2);
    createHoliday(db, { date: "2029-01-26", name: "Republic Day", type: "fixed" });
    expect(copyHolidaysFromYear(db, 2028, 2029)).toEqual({ created: 1, skipped: 2 });
    expect(listHolidays(db, 2029).map((h) => h.date)).toEqual(["2029-01-26", "2029-11-09"]);
    expect(getYearConfig(db, 2029).optionalAllowed).toBe(2);
    expect(db.select().from(holidays).all()).toHaveLength(5);
  });
});
