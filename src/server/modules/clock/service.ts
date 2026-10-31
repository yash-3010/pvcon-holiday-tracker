import { asc, desc, eq, sum } from "drizzle-orm";
import type { WorkMode } from "@/lib/attendance";
import type { SessionUser } from "@/lib/auth/types";
import { dateInTimeZone, formatHm, formatMinutes, minutesInZone, parseHm, zonedInstant, type ISODate } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import { attendancePunches, clockSelections, runningTimers, taskCategories, timesheetEntries, timesheets } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { recomputeAttendance } from "@/server/modules/attendance/compute";
import { clockIn, clockOut, clockState } from "@/server/modules/attendance/punches";
import { shiftForEmployee } from "@/server/modules/attendance/shifts";
import { getSetting } from "@/server/modules/settings/service";
import { allowedProjects, requireOwnEmployee } from "@/server/modules/timesheets/service";
import { dropTimer, runningTimer, startTimer, stopEmployeeTimer } from "@/server/modules/timesheets/timer";

/**
 * The work clock (roadmap refinement 84): one clock drives attendance and the timesheet. Clocking in starts logging
 * time to a project and task; a break pauses both; switching moves the logging to another task; clocking out stops.
 * Attendance always goes through: when the timesheet can't take time (a submitted week, no project), the clock still
 * runs and says why.
 */

export interface WorkSelection {
  projectId: number;
  taskCategoryId: number;
  notes: string | null;
}

export interface ClockActionResult {
  /** Local HH:MM of the action. */
  time: string;
  /** What the clock now logs time to, if anything. */
  logging: WorkSelection | null;
  /** Time this action added to the timesheet (the piece it ended). */
  added: { minutes: number; date: ISODate } | null;
  /** Why time didn't reach the timesheet. */
  notices: string[];
  punchId: number | null;
}

const timeZoneOf = (db: DbLike) => getSetting(db, "locale").timezone;
const localTime = (db: DbLike, now: Date) => formatHm(minutesInZone(now, timeZoneOf(db)));

function usable(db: DbLike, employeeId: number, selection: Omit<WorkSelection, "notes">, onDate: ISODate): boolean {
  if (!allowedProjects(db, employeeId, onDate).some((p) => p.id === selection.projectId)) return false;
  const category = db.select().from(taskCategories).where(eq(taskCategories.id, selection.taskCategoryId)).get();
  return !!category && !category.archived;
}

/**
 * The project and task the clock uses when nothing is chosen: the last choice while it's still open to them, else the
 * row with the most time in their latest timesheet, else their first project (client projects sort before Internal)
 * with the first task.
 */
export function defaultSelection(db: DbLike, employeeId: number, onDate: ISODate): WorkSelection | null {
  const saved = db.select().from(clockSelections).where(eq(clockSelections.employeeId, employeeId)).get();
  if (saved && usable(db, employeeId, saved, onDate)) return { projectId: saved.projectId, taskCategoryId: saved.taskCategoryId, notes: saved.notes };
  const latest = db
    .select({ id: timesheets.id })
    .from(timesheets)
    .innerJoin(timesheetEntries, eq(timesheetEntries.timesheetId, timesheets.id))
    .where(eq(timesheets.employeeId, employeeId))
    .orderBy(desc(timesheets.weekStart))
    .get();
  const rows = latest
    ? db
        .select({ projectId: timesheetEntries.projectId, taskCategoryId: timesheetEntries.taskCategoryId, minutes: sum(timesheetEntries.minutes).mapWith(Number) })
        .from(timesheetEntries)
        .where(eq(timesheetEntries.timesheetId, latest.id))
        .groupBy(timesheetEntries.projectId, timesheetEntries.taskCategoryId)
        .orderBy(desc(sum(timesheetEntries.minutes)))
        .all()
    : [];
  const logged = rows.find((r) => usable(db, employeeId, r, onDate));
  if (logged) return { projectId: logged.projectId, taskCategoryId: logged.taskCategoryId, notes: null };
  const project = allowedProjects(db, employeeId, onDate)[0];
  const category = db
    .select()
    .from(taskCategories)
    .where(eq(taskCategories.archived, false))
    .orderBy(asc(taskCategories.sortOrder), asc(taskCategories.name))
    .get();
  return project && category ? { projectId: project.id, taskCategoryId: category.id, notes: null } : null;
}

function remember(db: DbLike, employeeId: number, selection: WorkSelection): void {
  const values = { projectId: selection.projectId, taskCategoryId: selection.taskCategoryId, notes: selection.notes, updatedAt: nowIso() };
  db.insert(clockSelections).values({ employeeId, ...values }).onConflictDoUpdate({ target: clockSelections.employeeId, set: values }).run();
}

function startLogging(db: DbLike, actor: SessionUser, selection: WorkSelection, now: Date, notices: string[]): WorkSelection | null {
  try {
    startTimer(db, actor, selection, { now });
    remember(db, actor.employeeId!, selection);
    return selection;
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    notices.push(`Time isn't going to your timesheet: ${err.message}`);
    return null;
  }
}

/** Ends the piece being logged at `at`. Time the timesheet can't take (a submitted week) is dropped, with a notice. */
function stopLogging(db: DbLike, employeeId: number, at: Date, notices: string[]): ClockActionResult["added"] {
  const timer = runningTimer(db, employeeId);
  if (!timer) return null;
  try {
    return stopEmployeeTimer(db, employeeId, { at });
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    dropTimer(db, employeeId);
    const elapsed = Math.max(0, Math.floor((at.getTime() - Date.parse(timer.startedAt)) / 60_000));
    notices.push(`${formatMinutes(elapsed)} couldn't go to your timesheet: ${err.message}`);
    return null;
  }
}

/** A timer left running from an earlier day stops at that day's shift end; started after it, it adds nothing. */
function endForgottenTimer(db: DbLike, employeeId: number, notices: string[]): void {
  const timer = runningTimer(db, employeeId);
  if (!timer) return;
  const timeZone = timeZoneOf(db);
  const shiftEnd = zonedInstant(dateInTimeZone(new Date(timer.startedAt), timeZone), parseHm(shiftForEmployee(db, employeeId).endTime), timeZone);
  stopLogging(db, employeeId, new Date(Math.max(Date.parse(timer.startedAt), shiftEnd.getTime())), notices);
}

/** Clocks in and starts logging to `selection`, or to the default project and task. */
export function startWork(
  db: DbLike,
  actor: SessionUser,
  { workMode, selection }: { workMode: WorkMode; selection: WorkSelection | null },
  { now, ip }: { now: Date; ip: string | null },
): ClockActionResult {
  const employeeId = requireOwnEmployee(actor);
  const notices: string[] = [];
  const today = dateInTimeZone(now, timeZoneOf(db));
  const punch = clockIn(db, employeeId, { workMode, ip, now });
  const stale = runningTimer(db, employeeId);
  if (stale) {
    if (dateInTimeZone(new Date(stale.startedAt), timeZoneOf(db)) < today) endForgottenTimer(db, employeeId, notices);
    else stopLogging(db, employeeId, now, notices);
  }
  const chosen = selection ?? defaultSelection(db, employeeId, today);
  if (!chosen) notices.push("Time isn't going to your timesheet: you're not on any project yet.");
  const logging = chosen ? startLogging(db, actor, chosen, now, notices) : null;
  return { time: localTime(db, now), logging, added: null, notices, punchId: punch.id };
}

/** Pauses the day: attendance stops counting until resumed, and the piece being logged goes to the timesheet. */
export function takeBreak(db: DbLike, actor: SessionUser, { now, ip }: { now: Date; ip: string | null }): ClockActionResult {
  const employeeId = requireOwnEmployee(actor);
  const notices: string[] = [];
  const punch = clockOut(db, employeeId, { ip, now, startsBreak: true });
  const added = stopLogging(db, employeeId, now, notices);
  return { time: localTime(db, now), logging: null, added, notices, punchId: punch.id };
}

/** Ends a break, in the same work mode, logging to the last project and task. */
export function resumeWork(db: DbLike, actor: SessionUser, { now, ip }: { now: Date; ip: string | null }): ClockActionResult {
  const employeeId = requireOwnEmployee(actor);
  const state = clockState(db, employeeId, now);
  if (!state.onBreak) throw new DomainError("NOT_ON_BREAK", "You're not on a break.");
  const notices: string[] = [];
  const punch = clockIn(db, employeeId, { workMode: state.workMode ?? "office", ip, now });
  const chosen = defaultSelection(db, employeeId, state.date);
  if (!chosen) notices.push("Time isn't going to your timesheet: you're not on any project yet.");
  const logging = chosen ? startLogging(db, actor, chosen, now, notices) : null;
  return { time: localTime(db, now), logging, added: null, notices, punchId: punch.id };
}

/** Moves the logging to another project or task; when not working, it's what the clock will log to next. */
export function switchTask(db: DbLike, actor: SessionUser, selection: WorkSelection, { now }: { now: Date }): ClockActionResult {
  const employeeId = requireOwnEmployee(actor);
  const state = clockState(db, employeeId, now);
  if (!usable(db, employeeId, selection, state.date)) {
    throw new DomainError("PROJECT_NOT_ALLOWED", "You can't log time to that project and task today.", { projectId: ["Not open to you"] });
  }
  const notices: string[] = [];
  if (state.state !== "in") {
    remember(db, employeeId, selection);
    return { time: localTime(db, now), logging: null, added: null, notices, punchId: null };
  }
  const added = stopLogging(db, employeeId, now, notices);
  const logging = startLogging(db, actor, selection, now, notices);
  return { time: localTime(db, now), logging, added, notices, punchId: null };
}

/** Clocks out for the day. From a break, the day ended when the break began. */
export function endWork(db: DbLike, actor: SessionUser, { now, ip }: { now: Date; ip: string | null }): ClockActionResult {
  const employeeId = requireOwnEmployee(actor);
  const state = clockState(db, employeeId, now);
  const notices: string[] = [];
  if (state.onBreak) {
    const breakOut = db
      .select()
      .from(attendancePunches)
      .where(eq(attendancePunches.employeeId, employeeId))
      .orderBy(desc(attendancePunches.at), desc(attendancePunches.id))
      .get()!;
    db.update(attendancePunches).set({ startsBreak: false }).where(eq(attendancePunches.id, breakOut.id)).run();
    recomputeAttendance(db, employeeId, breakOut.date, breakOut.date, { now });
    return { time: formatHm(minutesInZone(new Date(breakOut.at), timeZoneOf(db))), logging: null, added: null, notices, punchId: breakOut.id };
  }
  const punch = clockOut(db, employeeId, { ip, now });
  const added = stopLogging(db, employeeId, now, notices);
  return { time: localTime(db, now), logging: null, added, notices, punchId: punch.id };
}

/** Nightly: a timer still running from `upTo` or before (its owner never clocked out) stops at that day's shift end. */
export function endForgottenTimers(db: DbLike, upTo: ISODate): number {
  const timeZone = timeZoneOf(db);
  let ended = 0;
  for (const timer of db.select().from(runningTimers).all()) {
    if (dateInTimeZone(new Date(timer.startedAt), timeZone) > upTo) continue;
    endForgottenTimer(db, timer.employeeId, []);
    ended += 1;
  }
  return ended;
}
