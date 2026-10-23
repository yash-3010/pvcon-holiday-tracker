import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { AttendanceMode, ShiftRules } from "@/lib/attendance";
import { parseHm } from "@/lib/dates";
import type { ShiftInput } from "@/lib/validation/attendance";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import { employees, shifts, type ShiftRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { getSetting, patchSetting } from "@/server/modules/settings/service";

const CURRENT = inArray(employees.status, ["active", "on_notice"]);

/** The company default before any shift exists: never stored, so reads never write. */
function virtualDefault(db: DbLike): ShiftRow {
  const { weeklyOffs, defaultMode } = getSetting(db, "attendance");
  const now = nowIso();
  return {
    id: 0, name: "General", startTime: "09:30", endTime: "18:30", breakMinutes: 60, graceMinutes: 15, halfDayMinutes: 240,
    fullDayMinutes: 480, weeklyOffs, attendanceMode: defaultMode, autoClockOutTime: "23:30", archived: false,
    createdAt: now, updatedAt: now,
  };
}

function getShift(db: DbLike, id: number): ShiftRow | undefined {
  return db.select().from(shifts).where(eq(shifts.id, id)).get();
}

export function requireShift(db: DbLike, id: number): ShiftRow {
  const row = getShift(db, id);
  if (!row) throw new DomainError("NOT_FOUND", "Shift not found.");
  return row;
}

/**
 * Creates the "General" 09:30–18:30 shift with the company weekly offs when no shift exists, and makes it the default.
 * Idempotent. The legacy migration seeds it in auto mode so migrated history isn't marked absent.
 */
export function seedDefaultShift(db: DbLike, opts: { attendanceMode?: AttendanceMode } = {}): ShiftRow {
  const current = getSetting(db, "attendance").defaultShiftId;
  const existing = current ? getShift(db, current) : db.select().from(shifts).where(eq(shifts.archived, false)).orderBy(asc(shifts.id)).get();
  if (existing) {
    if (current !== existing.id) patchSetting(db, "attendance", { defaultShiftId: existing.id }, null);
    return existing;
  }
  const { weeklyOffs, defaultMode } = getSetting(db, "attendance");
  const row = db
    .insert(shifts)
    .values({
      name: "General", startTime: "09:30", endTime: "18:30", breakMinutes: 60, graceMinutes: 15, halfDayMinutes: 240,
      fullDayMinutes: 480, weeklyOffs, attendanceMode: opts.attendanceMode ?? defaultMode, autoClockOutTime: "23:30",
    })
    .returning()
    .get();
  patchSetting(db, "attendance", { defaultShiftId: row.id }, null);
  return row;
}

/** The shift for employees without one. */
export function defaultShift(db: DbLike): ShiftRow {
  const id = getSetting(db, "attendance").defaultShiftId;
  const row = id ? getShift(db, id) : undefined;
  return row ?? virtualDefault(db);
}

export function shiftForEmployee(db: DbLike, employeeId: number): ShiftRow {
  const assigned = db
    .select({ shift: shifts })
    .from(employees)
    .innerJoin(shifts, eq(shifts.id, employees.shiftId))
    .where(eq(employees.id, employeeId))
    .get();
  return assigned?.shift ?? defaultShift(db);
}

export function shiftRules(shift: ShiftRow): ShiftRules {
  return {
    startMinutes: parseHm(shift.startTime),
    endMinutes: parseHm(shift.endTime),
    graceMinutes: shift.graceMinutes,
    halfDayMinutes: shift.halfDayMinutes,
    fullDayMinutes: shift.fullDayMinutes,
    weeklyOffs: shift.weeklyOffs,
    mode: shift.attendanceMode,
  };
}

function assertNameFree(db: DbLike, name: string, exceptId: number | null): void {
  const clash = db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(sql`lower(${shifts.name}) = ${name.toLowerCase()}`, exceptId === null ? undefined : ne(shifts.id, exceptId)))
    .get();
  if (clash) throw new DomainError("DUPLICATE_NAME", "A shift with this name already exists.", { name: ["Already exists"] });
}

export function createShift(db: DbLike, input: ShiftInput): ShiftRow {
  assertNameFree(db, input.name, null);
  return db.insert(shifts).values(input).returning().get();
}

export function updateShift(db: DbLike, id: number, input: ShiftInput): { before: ShiftRow; after: ShiftRow } {
  const before = requireShift(db, id);
  assertNameFree(db, input.name, id);
  const after = db.update(shifts).set(input).where(eq(shifts.id, id)).returning().get()!;
  return { before, after };
}

function currentEmployeesOn(db: DbLike, shiftId: number): number {
  return db.select({ n: count() }).from(employees).where(and(eq(employees.shiftId, shiftId), CURRENT)).get()?.n ?? 0;
}

export function setShiftArchived(db: DbLike, id: number, archived: boolean): ShiftRow {
  requireShift(db, id);
  if (archived) {
    if (getSetting(db, "attendance").defaultShiftId === id) {
      throw new DomainError("DEFAULT_SHIFT", "Make another shift the default before archiving this one.");
    }
    const n = currentEmployeesOn(db, id);
    if (n > 0) throw new DomainError("SHIFT_IN_USE", `Move this shift's ${n} current employee(s) to another shift first.`);
  }
  return db.update(shifts).set({ archived }).where(eq(shifts.id, id)).returning().get()!;
}

export function setDefaultShift(db: DbLike, id: number, actorUserId: number | null): ShiftRow {
  const row = requireShift(db, id);
  if (row.archived) throw new DomainError("ARCHIVED", "Choose an active shift.");
  patchSetting(db, "attendance", { defaultShiftId: id }, actorUserId);
  return row;
}

export interface ShiftListItem extends ShiftRow {
  employees: number;
  isDefault: boolean;
}

/** Shifts by name, with how many current employees work them (the default counts those without a shift). */
export function listShifts(db: DbLike, { includeArchived = false }: { includeArchived?: boolean } = {}): ShiftListItem[] {
  const defaultId = getSetting(db, "attendance").defaultShiftId;
  const counts = new Map(
    db
      .select({ shiftId: employees.shiftId, n: count() })
      .from(employees)
      .where(CURRENT)
      .groupBy(employees.shiftId)
      .all()
      .map((r) => [r.shiftId, r.n]),
  );
  return db
    .select()
    .from(shifts)
    .where(includeArchived ? undefined : eq(shifts.archived, false))
    .orderBy(asc(shifts.name))
    .all()
    .map((s) => ({
      ...s,
      isDefault: s.id === defaultId,
      employees: (counts.get(s.id) ?? 0) + (s.id === defaultId ? (counts.get(null) ?? 0) : 0),
    }));
}

/** null puts the employees back on the default shift. Recompute is the caller's job (Task 7 wires it into the action). */
export function assignShift(db: DbLike, employeeIds: number[], shiftId: number | null): number {
  if (shiftId !== null && requireShift(db, shiftId).archived) throw new DomainError("ARCHIVED", "Choose an active shift.");
  if (employeeIds.length === 0) return 0;
  return db.update(employees).set({ shiftId }).where(inArray(employees.id, employeeIds)).run().changes;
}

/** Current employees without a shift of their own, who follow the default. */
export function employeesOnDefaultShift(db: DbLike): number[] {
  return db.select({ id: employees.id }).from(employees).where(and(isNull(employees.shiftId), CURRENT)).all().map((r) => r.id);
}
