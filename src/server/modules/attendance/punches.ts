import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { PunchSource, WorkMode } from "@/lib/attendance";
import { dayClock, type DayClock } from "@/lib/clock";
import { addDays, dateInTimeZone, parseHm, zonedInstant, type ISODate } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import { attendancePunches, employees, type AttendancePunchRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { getSetting } from "@/server/modules/settings/service";
import { recomputeAttendance } from "./compute";
import { shiftForEmployee } from "./shifts";

export interface ClockState {
  state: "in" | "out";
  /** Out on a break rather than done for the day. */
  onBreak: boolean;
  /** When the open session started (UTC ISO). */
  since: string | null;
  /** The current session's work mode, or on a break the last one. */
  workMode: WorkMode | null;
  todayWorkedMinutes: number;
  date: ISODate;
  /** Today's full reading, to the second, for the live clock. */
  day: DayClock;
}

const timeZoneOf = (db: DbLike) => getSetting(db, "locale").timezone;

function lastPunch(db: DbLike, employeeId: number): AttendancePunchRow | undefined {
  return db
    .select()
    .from(attendancePunches)
    .where(eq(attendancePunches.employeeId, employeeId))
    .orderBy(desc(attendancePunches.at), desc(attendancePunches.id))
    .get();
}

export function clockState(db: DbLike, employeeId: number, now: Date): ClockState {
  const date = dateInTimeZone(now, timeZoneOf(db));
  const today = db
    .select()
    .from(attendancePunches)
    .where(and(eq(attendancePunches.employeeId, employeeId), eq(attendancePunches.date, date)))
    .orderBy(attendancePunches.at, attendancePunches.id)
    .all();
  const day = dayClock(today, now);
  const last = today.at(-1);
  return {
    state: day.state === "working" ? "in" : "out",
    onBreak: day.state === "break",
    since: day.sessionStartedAt,
    workMode: day.state === "working" || day.state === "break" ? (last?.workMode ?? null) : null,
    todayWorkedMinutes: Math.floor(day.workedSeconds / 60),
    date,
    day,
  };
}

/** Closes an open session on its own date at the shift's auto clock-out time (or the shift end). */
function closeSession(db: DbLike, open: AttendancePunchRow, timeZone: string): void {
  const shift = shiftForEmployee(db, open.employeeId);
  const closeAt = zonedInstant(open.date, parseHm(shift.autoClockOutTime ?? shift.endTime), timeZone);
  const at = closeAt.getTime() > Date.parse(open.at) ? closeAt.toISOString() : open.at;
  db.insert(attendancePunches)
    .values({
      employeeId: open.employeeId, at, date: open.date, direction: "out", workMode: open.workMode, source: "auto",
      note: "Automatic clock-out",
    })
    .run();
}

export interface PunchOptions {
  ip: string | null;
  now: Date;
  source?: PunchSource;
  createdBy?: number | null;
}

export function clockIn(db: DbLike, employeeId: number, opts: PunchOptions & { workMode: WorkMode }): AttendancePunchRow {
  const timeZone = timeZoneOf(db);
  const date = dateInTimeZone(opts.now, timeZone);
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (
    !employee ||
    employee.status === "exited" ||
    date < employee.dateOfJoining ||
    (employee.lastWorkingDate !== null && date > employee.lastWorkingDate)
  ) {
    throw new DomainError("NOT_WORKING", "Only current employees can clock in.");
  }
  const last = lastPunch(db, employeeId);
  if (last?.direction === "in") {
    if (last.date === date) throw new DomainError("ALREADY_IN", "You're already clocked in.");
    // A forgotten session from an earlier day ends at that day's automatic clock-out time.
    closeSession(db, last, timeZone);
    recomputeAttendance(db, employeeId, last.date, last.date, { now: opts.now });
  }
  const row = db
    .insert(attendancePunches)
    .values({
      employeeId, at: opts.now.toISOString(), date, direction: "in", workMode: opts.workMode, source: opts.source ?? "web",
      ip: opts.ip, createdBy: opts.createdBy ?? null,
    })
    .returning()
    .get();
  recomputeAttendance(db, employeeId, date, date, { now: opts.now });
  return row;
}

/** `startsBreak` marks the out as the start of a break: the day goes on, and the next clock-in resumes it. */
export function clockOut(db: DbLike, employeeId: number, opts: PunchOptions & { startsBreak?: boolean }): AttendancePunchRow {
  const timeZone = timeZoneOf(db);
  const date = dateInTimeZone(opts.now, timeZone);
  const last = lastPunch(db, employeeId);
  if (last?.direction !== "in" || last.date !== date) throw new DomainError("NOT_IN", "You're not clocked in.");
  const row = db
    .insert(attendancePunches)
    .values({
      employeeId, at: opts.now.toISOString(), date, direction: "out", workMode: last.workMode, source: opts.source ?? "web",
      startsBreak: opts.startsBreak ?? false, ip: opts.ip, createdBy: opts.createdBy ?? null,
    })
    .returning()
    .get();
  recomputeAttendance(db, employeeId, date, date, { now: opts.now });
  return row;
}

/** Closes every session still open on `upTo` or the week before it (nightly, spec §5.2). Returns how many were closed. */
export function autoClockOut(db: DbLike, upTo: ISODate, now: Date): number {
  const timeZone = timeZoneOf(db);
  const recent = db
    .select()
    .from(attendancePunches)
    .where(and(gte(attendancePunches.date, addDays(upTo, -7)), lte(attendancePunches.date, upTo)))
    .orderBy(desc(attendancePunches.at), desc(attendancePunches.id))
    .all();
  const lastByEmployee = new Map<number, AttendancePunchRow>();
  for (const p of recent) if (!lastByEmployee.has(p.employeeId)) lastByEmployee.set(p.employeeId, p);
  let closed = 0;
  for (const last of lastByEmployee.values()) {
    if (last.direction !== "in") continue;
    // A later punch (e.g. today's) means the session was already dealt with.
    if (lastPunch(db, last.employeeId)?.id !== last.id) continue;
    closeSession(db, last, timeZone);
    recomputeAttendance(db, last.employeeId, last.date, last.date, { now });
    closed += 1;
  }
  return closed;
}
