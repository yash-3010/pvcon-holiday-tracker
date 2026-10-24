import { and, eq } from "drizzle-orm";
import type { AttendanceStatus } from "@/lib/attendance";
import { dateInTimeZone, type ISODate } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import { attendanceDays, type AttendanceDayRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { getSetting } from "@/server/modules/settings/service";
import { recomputeAttendance, type RecomputeOptions } from "./compute";

/** Makes sure the day's row exists and may be changed; returns it. */
function editableDay(db: DbLike, employeeId: number, date: ISODate, opts: RecomputeOptions): AttendanceDayRow {
  const today = dateInTimeZone(opts.now ?? new Date(), getSetting(db, "locale").timezone);
  if (date > today) throw new DomainError("FUTURE_DATE", "Attendance can only be corrected for today or earlier.");
  recomputeAttendance(db, employeeId, date, date, opts);
  const key = and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, date));
  const row = db.select().from(attendanceDays).where(key).get();
  if (!row) throw new DomainError("NOT_EMPLOYED", "The employee wasn't employed on that date.");
  if (row.locked) throw new DomainError("DAY_LOCKED", "Payroll for this day is approved, so it can't change.");
  return row;
}

/** An admin decision that wins over the computed status (spec §5.2). */
export function setOverride(
  db: DbLike,
  actorUserId: number,
  { employeeId, date, status, note }: { employeeId: number; date: ISODate; status: AttendanceStatus; note: string },
  opts: RecomputeOptions = {},
): AttendanceDayRow {
  editableDay(db, employeeId, date, opts);
  db.update(attendanceDays)
    .set({ overrideStatus: status, overrideNote: note, overrideBy: actorUserId, overrideAt: nowIso() })
    .where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, date)))
    .run();
  recomputeAttendance(db, employeeId, date, date, opts);
  return db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, date))).get()!;
}

export function clearOverride(db: DbLike, { employeeId, date }: { employeeId: number; date: ISODate }, opts: RecomputeOptions = {}): AttendanceDayRow {
  editableDay(db, employeeId, date, opts);
  db.update(attendanceDays)
    .set({ overrideStatus: null, overrideNote: null, overrideBy: null, overrideAt: null })
    .where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, date)))
    .run();
  recomputeAttendance(db, employeeId, date, date, opts);
  return db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, date))).get()!;
}
