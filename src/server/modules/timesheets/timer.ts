import { and, eq, sql } from "drizzle-orm";
import { nowIso } from "@/server/db/columns";
import type { SessionUser } from "@/lib/auth/types";
import { addDays, dateInTimeZone, startOfWeek, zonedInstant, type ISODate } from "@/lib/dates";
import { DAY_MINUTES, roundTimerMinutes } from "@/lib/timesheets";
import type { TimerStartInput } from "@/lib/validation/timesheets";
import type { DbLike } from "@/server/db/client";
import { runningTimers, taskCategories, timesheetEntries, timesheets, type RunningTimerRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { requireProject } from "@/server/modules/projects/service";
import { getSetting } from "@/server/modules/settings/service";
import { allowedProjects, assertEditable, findTimesheet, getOrCreateTimesheet, requireOwnEmployee, shortDay } from "./service";

export function runningTimer(db: DbLike, employeeId: number): RunningTimerRow | undefined {
  return db.select().from(runningTimers).where(eq(runningTimers.employeeId, employeeId)).get();
}

const timeZoneOf = (db: DbLike) => getSetting(db, "locale").timezone;

export function startTimer(db: DbLike, actor: SessionUser, input: TimerStartInput, { now }: { now: Date }): RunningTimerRow {
  const employeeId = requireOwnEmployee(actor);
  if (runningTimer(db, employeeId)) throw new DomainError("TIMER_RUNNING", "A timer is already running. Stop it first.");
  const today = dateInTimeZone(now, timeZoneOf(db));
  if (!allowedProjects(db, employeeId, today).some((p) => p.id === input.projectId)) {
    throw new DomainError("PROJECT_NOT_ALLOWED", "You can't log time to that project today.", { projectId: ["Not open to you"] });
  }
  const category = db.select().from(taskCategories).where(eq(taskCategories.id, input.taskCategoryId)).get();
  if (!category || category.archived) throw new DomainError("CATEGORY_ARCHIVED", "Choose an active task category.", { taskCategoryId: ["Not available"] });
  assertEditable(findTimesheet(db, employeeId, startOfWeek(today)));
  return db
    .insert(runningTimers)
    .values({ employeeId, projectId: input.projectId, taskCategoryId: input.taskCategoryId, notes: input.notes, startedAt: now.toISOString() })
    .returning()
    .get();
}

/**
 * Adds the employee's running timer, up to `at` and rounded to a quarter hour, to its start date's entry: a timer never
 * counts past that date's local midnight. Null when no timer runs. Refused when the week has been submitted meanwhile;
 * the timer then stays so the caller can drop it. Adding time bumps the week's `updated_at`, which an open grid checks.
 */
export function stopEmployeeTimer(db: DbLike, employeeId: number, { at }: { at: Date }): { minutes: number; date: ISODate } | null {
  const timer = runningTimer(db, employeeId);
  if (!timer) return null;
  const timeZone = timeZoneOf(db);
  const started = new Date(timer.startedAt);
  const date = dateInTimeZone(started, timeZone);
  const end = Math.min(at.getTime(), zonedInstant(addDays(date, 1), 0, timeZone).getTime());
  const minutes = roundTimerMinutes(Math.max(0, Math.floor((end - started.getTime()) / 60_000)));
  if (minutes > 0) {
    assertEditable(findTimesheet(db, employeeId, startOfWeek(date)));
    const timesheet = getOrCreateTimesheet(db, employeeId, startOfWeek(date));
    const dayTotal =
      db
        .select({ n: sql<number>`coalesce(sum(${timesheetEntries.minutes}), 0)` })
        .from(timesheetEntries)
        .where(and(eq(timesheetEntries.timesheetId, timesheet.id), eq(timesheetEntries.date, date)))
        .get()?.n ?? 0;
    if (dayTotal + minutes > DAY_MINUTES) throw new DomainError("DAY_OVER_24H", `${shortDay(date)} would add up to more than 24 hours.`);
    const row = and(
      eq(timesheetEntries.timesheetId, timesheet.id),
      eq(timesheetEntries.projectId, timer.projectId),
      eq(timesheetEntries.taskCategoryId, timer.taskCategoryId),
    );
    const cell = db.select().from(timesheetEntries).where(and(row, eq(timesheetEntries.date, date))).get();
    if (cell) {
      db.update(timesheetEntries).set({ minutes: cell.minutes + minutes }).where(eq(timesheetEntries.id, cell.id)).run();
    } else {
      // A new cell joins its row's billable flag and note, or starts the row with the defaults and the timer's note.
      const sibling = db.select().from(timesheetEntries).where(row).get();
      const project = requireProject(db, timer.projectId);
      const category = db.select().from(taskCategories).where(eq(taskCategories.id, timer.taskCategoryId)).get()!;
      db.insert(timesheetEntries)
        .values({
          timesheetId: timesheet.id, projectId: timer.projectId, taskCategoryId: timer.taskCategoryId, date, minutes,
          billable: sibling?.billable ?? (project.billableDefault && category.billableDefault),
          notes: sibling ? sibling.notes : timer.notes,
        })
        .run();
    }
    db.update(timesheets).set({ updatedAt: nowIso() }).where(eq(timesheets.id, timesheet.id)).run();
  }
  dropTimer(db, employeeId);
  return { minutes, date };
}

/** Throws the timer away without adding its time. */
export function dropTimer(db: DbLike, employeeId: number): void {
  db.delete(runningTimers).where(eq(runningTimers.employeeId, employeeId)).run();
}
