import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { computeAttendanceDay, pairPunches, type AttendanceStatus } from "@/lib/attendance";
import { dateInTimeZone, dayOfWeek, eachDay, minutesInZone, type ISODate } from "@/lib/dates";
import { requestPortions, type LeaveHalf } from "@/lib/leave";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import { attendanceDays, attendancePunches, employees, leaveRequests } from "@/server/db/schema";
import { holidaysForEmployee } from "@/server/modules/holidays/service";
import { getSetting } from "@/server/modules/settings/service";
import { shiftForEmployee, shiftRules } from "./shifts";

export interface RecomputeOptions {
  now?: Date;
}

/**
 * Rebuilds `attendance_days` for one employee over [from, to] (spec §5.2), from punches, approved leave, holidays, the
 * shift and any override. Days before joining, after the last working day and after today are not stored. Locked
 * (payroll-approved) days are left exactly as they are.
 */
export function recomputeAttendance(
  db: DbLike,
  employeeId: number,
  from: ISODate,
  to: ISODate,
  { now = new Date() }: RecomputeOptions = {},
): { written: number; skippedLocked: number } {
  const result = { written: 0, skippedLocked: 0 };
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!employee) return result;
  const timeZone = getSetting(db, "locale").timezone;
  const today = dateInTimeZone(now, timeZone);
  const start = from > employee.dateOfJoining ? from : employee.dateOfJoining;
  let end = to < today ? to : today;
  if (employee.lastWorkingDate && employee.lastWorkingDate < end) end = employee.lastWorkingDate;
  if (start > end) return result;

  const rules = shiftRules(shiftForEmployee(db, employeeId));
  const holidays = new Map(holidaysForEmployee(db, employeeId, start, end).map((h) => [h.date, h.name]));

  const leave = new Map<ISODate, { portion: LeaveHalf; requestId: number }[]>();
  const approved = db
    .select()
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        eq(leaveRequests.status, "approved"),
        lte(leaveRequests.startDate, end),
        gte(leaveRequests.endDate, start),
      ),
    )
    .all();
  for (const r of approved) {
    for (const [date, portion] of requestPortions(r.startDate, r.endDate, r.startHalf, r.endHalf)) {
      leave.set(date, [...(leave.get(date) ?? []), { portion, requestId: r.id }]);
    }
  }

  const punches = db
    .select()
    .from(attendancePunches)
    .where(and(eq(attendancePunches.employeeId, employeeId), gte(attendancePunches.date, start), lte(attendancePunches.date, end)))
    .all();
  const byDate = new Map<ISODate, typeof punches>();
  for (const p of punches) byDate.set(p.date, [...(byDate.get(p.date) ?? []), p]);

  const existing = new Map(
    db
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employeeId), gte(attendanceDays.date, start), lte(attendanceDays.date, end)))
      .all()
      .map((row) => [row.date, row]),
  );

  for (const date of eachDay(start, end)) {
    const row = existing.get(date);
    if (row?.locked) {
      result.skippedLocked += 1;
      continue;
    }
    const all = byDate.get(date) ?? [];
    // An approved regularization rewrites the day: its punches replace the others.
    const corrected = all.filter((p) => p.source === "regularization");
    const sessions = pairPunches(
      (corrected.length ? corrected : all).map((p) => ({ minutes: minutesInZone(new Date(p.at), timeZone), direction: p.direction })),
    );
    const computed = computeAttendanceDay({
      date,
      weekday: dayOfWeek(date),
      dateOfJoining: employee.dateOfJoining,
      lastWorkingDate: employee.lastWorkingDate,
      shift: rules,
      holiday: holidays.get(date) ?? null,
      leave: leave.get(date) ?? [],
      sessions,
      nowMinutes: date === today ? minutesInZone(now, timeZone) : null,
      override: (row?.overrideStatus as AttendanceStatus | null) ?? null,
    });
    const values = { ...computed, computedAt: nowIso() };
    db.insert(attendanceDays)
      .values({ employeeId, date, ...values })
      .onConflictDoUpdate({ target: [attendanceDays.employeeId, attendanceDays.date], set: values })
      .run();
    result.written += 1;
  }
  return result;
}

/** Recomputes one date for everyone employed on it (after a holiday change, or the nightly close). Returns the count. */
export function recomputeDateForAll(db: DbLike, date: ISODate, opts: RecomputeOptions = {}): number {
  const today = dateInTimeZone(opts.now ?? new Date(), getSetting(db, "locale").timezone);
  if (date > today) return 0;
  const people = db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        lte(employees.dateOfJoining, date),
        or(isNull(employees.lastWorkingDate), gte(employees.lastWorkingDate, date)),
        inArray(employees.status, ["active", "on_notice", "exited"]),
      ),
    )
    .all();
  let written = 0;
  for (const { id } of people) written += recomputeAttendance(db, id, date, date, opts).written;
  return written;
}

/**
 * After a shift change: rebuilds today's row for these employees. Earlier days keep the rules they were computed with
 * until something else (leave, a regularization, an override) recomputes them.
 */
export function recomputeToday(db: DbLike, employeeIds: number[], opts: RecomputeOptions = {}): number {
  const today = dateInTimeZone(opts.now ?? new Date(), getSetting(db, "locale").timezone);
  let written = 0;
  for (const id of employeeIds) written += recomputeAttendance(db, id, today, today, opts).written;
  return written;
}
