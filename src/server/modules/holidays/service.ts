import { and, asc, count, eq, gte, inArray, lte, or } from "drizzle-orm";
import Papa from "papaparse";
import type { ISODate } from "@/lib/dates";
import type { HolidayType } from "@/lib/leave";
import { holidaySchema, type HolidayInput } from "@/lib/validation/leave";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import { holidaySelections, holidays, holidayYearConfig, type HolidayRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { onHolidayChanged } from "@/server/modules/attendance/hooks";

const yearOf = (date: ISODate) => Number(date.slice(0, 4));

function requireHoliday(db: DbLike, id: number): HolidayRow {
  const row = db.select().from(holidays).where(eq(holidays.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Holiday not found.");
  return row;
}

function assertDateFree(db: DbLike, date: ISODate, exceptId: number | null): void {
  const clash = db.select({ id: holidays.id }).from(holidays).where(eq(holidays.date, date)).get();
  if (clash && clash.id !== exceptId) {
    throw new DomainError("DATE_TAKEN", "There is already a holiday on this date.", { date: ["Already a holiday"] });
  }
}

export function listHolidays(db: DbLike, year: number): HolidayRow[] {
  return db.select().from(holidays).where(eq(holidays.year, year)).orderBy(asc(holidays.date)).all();
}

export function createHoliday(db: DbLike, input: HolidayInput): HolidayRow {
  assertDateFree(db, input.date, null);
  const row = db.insert(holidays).values({ ...input, year: yearOf(input.date) }).returning().get();
  onHolidayChanged(db, row.date);
  return row;
}

export function updateHoliday(db: DbLike, id: number, input: HolidayInput): { before: HolidayRow; after: HolidayRow } {
  const before = requireHoliday(db, id);
  if (input.date !== before.date) assertDateFree(db, input.date, id);
  const after = db
    .update(holidays)
    .set({ ...input, year: yearOf(input.date) })
    .where(eq(holidays.id, id))
    .returning()
    .get()!;
  // A fixed holiday applies to everyone, so earlier picks of it mean nothing.
  if (after.type === "fixed") db.delete(holidaySelections).where(eq(holidaySelections.holidayId, id)).run();
  onHolidayChanged(db, before.date);
  if (after.date !== before.date) onHolidayChanged(db, after.date);
  return { before, after };
}

export function deleteHoliday(db: DbLike, id: number): HolidayRow {
  const row = requireHoliday(db, id);
  db.delete(holidays).where(eq(holidays.id, id)).run();
  onHolidayChanged(db, row.date);
  return row;
}

export function getYearConfig(db: DbLike, year: number): { year: number; optionalAllowed: number } {
  const row = db.select().from(holidayYearConfig).where(eq(holidayYearConfig.year, year)).get();
  return { year, optionalAllowed: row?.optionalAllowed ?? 0 };
}

export function setYearConfig(db: DbLike, year: number, optionalAllowed: number): void {
  db.insert(holidayYearConfig)
    .values({ year, optionalAllowed })
    .onConflictDoUpdate({ target: holidayYearConfig.year, set: { optionalAllowed, updatedAt: nowIso() } })
    .run();
}

export interface HolidayImportResult {
  created: number;
  errors: { row: number; message: string }[];
}

/** CSV with `date,name[,type]` (type defaults to fixed). All-or-nothing; row 0 means the whole file. */
export function importHolidaysCsv(db: DbLike, csv: string): HolidayImportResult {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase(),
  });
  const headers = parsed.meta.fields ?? [];
  const missing = ["date", "name"].filter((column) => !headers.includes(column));
  if (missing.length) return { created: 0, errors: [{ row: 0, message: `Missing column(s): ${missing.join(", ")}` }] };
  if (parsed.data.length === 0) return { created: 0, errors: [{ row: 0, message: "The file has no data rows" }] };

  const errors: HolidayImportResult["errors"] = [];
  const valid: HolidayInput[] = [];
  const inFile = new Map<string, number>();
  parsed.data.forEach((raw, index) => {
    const row = index + 1;
    const result = holidaySchema.safeParse({
      date: raw.date ?? "",
      name: raw.name ?? "",
      type: (raw.type ?? "").trim().toLowerCase() || "fixed",
    });
    if (!result.success) {
      errors.push({ row, message: result.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`).join("; ") });
      return;
    }
    const { date } = result.data;
    if (inFile.has(date)) errors.push({ row, message: `date: repeats row ${inFile.get(date)}` });
    else if (db.select({ id: holidays.id }).from(holidays).where(eq(holidays.date, date)).get()) {
      errors.push({ row, message: `date: ${date} is already a holiday` });
    } else {
      inFile.set(date, row);
      valid.push(result.data);
    }
  });
  if (errors.length) return { created: 0, errors };
  for (const input of valid) createHoliday(db, input);
  return { created: valid.length, errors: [] };
}

/** Same month and day in `toYear` (festival dates still need checking); skips 29 Feb and dates already taken. */
export function copyHolidaysFromYear(db: DbLike, fromYear: number, toYear: number): { created: number; skipped: number } {
  let created = 0;
  let skipped = 0;
  for (const holiday of listHolidays(db, fromYear)) {
    const date = `${toYear}${holiday.date.slice(4)}`;
    const valid = holidaySchema.safeParse({ date, name: holiday.name, type: holiday.type });
    if (!valid.success || db.select({ id: holidays.id }).from(holidays).where(eq(holidays.date, date)).get()) {
      skipped += 1;
      continue;
    }
    createHoliday(db, valid.data);
    created += 1;
  }
  if (!db.select().from(holidayYearConfig).where(eq(holidayYearConfig.year, toYear)).get()) {
    const from = db.select().from(holidayYearConfig).where(eq(holidayYearConfig.year, fromYear)).get();
    if (from) setYearConfig(db, toYear, from.optionalAllowed);
  }
  return { created, skipped };
}

export function optionalUsed(db: DbLike, employeeId: number, year: number): number {
  return (
    db
      .select({ n: count() })
      .from(holidaySelections)
      .innerJoin(holidays, eq(holidays.id, holidaySelections.holidayId))
      .where(and(eq(holidaySelections.employeeId, employeeId), eq(holidays.year, year), eq(holidays.type, "optional")))
      .get()?.n ?? 0
  );
}

/** Picks are per calendar year and lock once the holiday's date has passed (spec §5.4). Idempotent. */
export function selectOptionalHoliday(db: DbLike, employeeId: number, holidayId: number, selected: boolean, today: ISODate): void {
  const holiday = requireHoliday(db, holidayId);
  if (holiday.type !== "optional") throw new DomainError("NOT_OPTIONAL", "Only optional holidays can be picked.");
  if (holiday.date < today) throw new DomainError("HOLIDAY_PASSED", "This holiday has passed, so the choice is locked.");
  const key = and(eq(holidaySelections.employeeId, employeeId), eq(holidaySelections.holidayId, holidayId));
  const existing = db.select().from(holidaySelections).where(key).get();
  if (!selected) {
    if (existing) db.delete(holidaySelections).where(key).run();
    return;
  }
  if (existing) return;
  const allowed = getYearConfig(db, holiday.year).optionalAllowed;
  if (optionalUsed(db, employeeId, holiday.year) >= allowed) {
    throw new DomainError("OPTIONAL_LIMIT", `You can pick ${allowed} optional holiday(s) in ${holiday.year}. Unpick one first.`);
  }
  db.insert(holidaySelections).values({ employeeId, holidayId }).run();
}

export interface OptionalPick {
  holidayId: number;
  date: ISODate;
  name: string;
  selected: boolean;
  locked: boolean;
}

export function optionalPicksFor(db: DbLike, employeeId: number, year: number, today: ISODate): OptionalPick[] {
  const picked = new Set(
    db
      .select({ id: holidaySelections.holidayId })
      .from(holidaySelections)
      .where(eq(holidaySelections.employeeId, employeeId))
      .all()
      .map((r) => r.id),
  );
  return listHolidays(db, year)
    .filter((h) => h.type === "optional")
    .map((h) => ({ holidayId: h.id, date: h.date, name: h.name, selected: picked.has(h.id), locked: h.date < today }));
}

/** Fixed holidays plus the optional ones the employee picked, by date. */
export function holidaysForEmployee(
  db: DbLike,
  employeeId: number,
  from: ISODate,
  to: ISODate,
): { date: ISODate; name: string; type: HolidayType }[] {
  const picked = db
    .select({ id: holidaySelections.holidayId })
    .from(holidaySelections)
    .where(eq(holidaySelections.employeeId, employeeId))
    .all()
    .map((r) => r.id);
  return db
    .select({ date: holidays.date, name: holidays.name, type: holidays.type })
    .from(holidays)
    .where(
      and(
        gte(holidays.date, from),
        lte(holidays.date, to),
        or(eq(holidays.type, "fixed"), picked.length ? inArray(holidays.id, picked) : undefined),
      ),
    )
    .orderBy(asc(holidays.date))
    .all();
}

export function holidayDatesForEmployee(db: DbLike, employeeId: number, from: ISODate, to: ISODate): Set<ISODate> {
  return new Set(holidaysForEmployee(db, employeeId, from, to).map((h) => h.date));
}
