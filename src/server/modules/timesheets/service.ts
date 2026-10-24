import { and, asc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/types";
import { dateInTimeZone, dayOfWeek, formatDate, startOfWeek, type ISODate } from "@/lib/dates";
import { WEEKDAY_LABELS } from "@/lib/leave";
import { DAY_MINUTES, EDITABLE_STATUSES, formatHours, weekDates } from "@/lib/timesheets";
import type { WeekSaveInput } from "@/lib/validation/timesheets";
import type { DbLike } from "@/server/db/client";
import {
  employees, projectMembers, projects, runningTimers, taskCategories, timesheetEntries, timesheets, users, type ProjectRow, type TimesheetRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { approverUserIdsFor, canDecideFor, TIMESHEET_APPROVAL } from "@/server/modules/approvals/routing";
import { requireEmployee } from "@/server/modules/employees/service";
import type { ScopeUser } from "@/server/modules/employees/scope";
import { notify, notifyMany } from "@/server/modules/notifications/service";
import { getSetting } from "@/server/modules/settings/service";
import { availableMinutes, workCalendar } from "./availability";

export const shortDay = (date: ISODate) => `${WEEKDAY_LABELS[dayOfWeek(date)]!.slice(0, 3)} ${formatDate(date, { day: "numeric", month: "short" })}`;

/**
 * Projects the employee may log time to on `onDate` (spec §5.3): active, inside the project's dates, and either
 * internal (no client, open to everyone) or with the employee as an active member.
 */
export function allowedProjects(db: DbLike, employeeId: number, onDate: ISODate): ProjectRow[] {
  return db
    .select({ project: projects })
    .from(projects)
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.employeeId, employeeId), eq(projectMembers.active, true)),
    )
    .where(
      and(
        eq(projects.status, "active"),
        or(isNull(projects.startDate), lte(projects.startDate, onDate)),
        or(isNull(projects.endDate), gte(projects.endDate, onDate)),
        or(isNull(projects.clientId), eq(projectMembers.active, true)),
      ),
    )
    .orderBy(asc(projects.code))
    .all()
    .map((r) => r.project);
}

export function findTimesheet(db: DbLike, employeeId: number, weekStart: ISODate): TimesheetRow | undefined {
  return db.select().from(timesheets).where(and(eq(timesheets.employeeId, employeeId), eq(timesheets.weekStart, weekStart))).get();
}

export function getOrCreateTimesheet(db: DbLike, employeeId: number, weekStart: ISODate): TimesheetRow {
  return findTimesheet(db, employeeId, weekStart) ?? db.insert(timesheets).values({ employeeId, weekStart }).returning().get();
}

export function assertEditable(timesheet: TimesheetRow | undefined): void {
  if (timesheet && !EDITABLE_STATUSES.includes(timesheet.status)) {
    throw new DomainError("TIMESHEET_LOCKED", "This week has been submitted. Withdraw it first, or wait for your manager's decision.");
  }
}

export function requireOwnEmployee(actor: SessionUser): number {
  if (actor.employeeId === null) throw new DomainError("NO_EMPLOYEE", "Your login isn't linked to an employee record.");
  return actor.employeeId;
}

/**
 * Replaces the actor's entries for a draft or rejected week (spec §5.3). Projects already in the stored week stay
 * allowed, so a project closing mid-week doesn't strand its rows. Returns warnings for time on full days of leave.
 */
export function saveWeek(
  db: DbLike,
  actor: SessionUser,
  { weekStart, rows }: WeekSaveInput,
  { today }: { today: ISODate },
): { timesheet: TimesheetRow; warnings: string[] } {
  const employeeId = requireOwnEmployee(actor);
  const employee = requireEmployee(db, employeeId);
  if (weekStart > startOfWeek(today)) throw new DomainError("FUTURE_WEEK", "This week hasn't started yet.");
  const existing = findTimesheet(db, employeeId, weekStart);
  assertEditable(existing);

  const kept = existing
    ? db.select().from(timesheetEntries).where(eq(timesheetEntries.timesheetId, existing.id)).all()
    : [];
  const keptProjects = new Set(kept.map((e) => e.projectId));
  const keptCategories = new Set(kept.map((e) => e.taskCategoryId));
  const allowedOn = new Map<ISODate, Set<number>>();
  const isAllowed = (projectId: number, date: ISODate) => {
    if (!allowedOn.has(date)) allowedOn.set(date, new Set(allowedProjects(db, employeeId, date).map((p) => p.id)));
    return keptProjects.has(projectId) || allowedOn.get(date)!.has(projectId);
  };

  const days = new Set(weekDates(weekStart));
  const totals = new Map<ISODate, number>();
  const cells: Omit<typeof timesheetEntries.$inferInsert, "timesheetId">[] = [];
  for (const row of rows) {
    const category = db.select().from(taskCategories).where(eq(taskCategories.id, row.taskCategoryId)).get();
    if (!category) throw new DomainError("NOT_FOUND", "Task category not found.", { rows: ["Unknown task category"] });
    if (category.archived && !keptCategories.has(category.id)) {
      throw new DomainError("CATEGORY_ARCHIVED", `"${category.name}" is no longer in use.`, { rows: [`${category.name} is archived`] });
    }
    for (const [date, minutes] of Object.entries(row.minutes)) {
      if (minutes === 0) continue;
      if (!days.has(date)) throw new DomainError("OUTSIDE_WEEK", "Every date must be in this week.", { rows: ["Date outside the week"] });
      if (date > today) throw new DomainError("FUTURE_DATE", "You can't log time for days that haven't happened yet.", { rows: [`${shortDay(date)} is in the future`] });
      if (date < employee.dateOfJoining || (employee.lastWorkingDate && date > employee.lastWorkingDate)) {
        throw new DomainError("NOT_EMPLOYED", `You weren't employed on ${shortDay(date)}.`, { rows: [`Not employed on ${shortDay(date)}`] });
      }
      if (!isAllowed(row.projectId, date)) {
        throw new DomainError("PROJECT_NOT_ALLOWED", `You can't log time to that project on ${shortDay(date)}.`, { rows: ["Project not open to you"] });
      }
      totals.set(date, (totals.get(date) ?? 0) + minutes);
      cells.push({ projectId: row.projectId, taskCategoryId: row.taskCategoryId, date, minutes, billable: row.billable, notes: row.notes || null });
    }
  }
  for (const [date, total] of totals) {
    if (total > DAY_MINUTES) throw new DomainError("DAY_OVER_24H", `${shortDay(date)} adds up to more than 24 hours.`, { rows: [`${shortDay(date)} is over 24 hours`] });
  }

  const timesheet = existing ?? db.insert(timesheets).values({ employeeId, weekStart }).returning().get();
  db.delete(timesheetEntries).where(eq(timesheetEntries.timesheetId, timesheet.id)).run();
  for (const cell of cells) db.insert(timesheetEntries).values({ ...cell, timesheetId: timesheet.id }).run();
  const saved = db.update(timesheets).set({ updatedAt: new Date().toISOString() }).where(eq(timesheets.id, timesheet.id)).returning().get()!;

  const leaveDays = new Set(workCalendar(db, employeeId, weekStart, weekDates(weekStart)[6]!).filter((d) => d.kind === "leave").map((d) => d.date));
  const warnings = [...totals.keys()].filter((d) => leaveDays.has(d)).sort().map((d) => `${shortDay(d)} is a full day of leave.`);
  return { timesheet: saved, warnings };
}

// ---------------------------------------------------------------------------------------------------------------
// Submit and decide (spec §5.3): the reporting manager, or an org-wide approver, decides; never one's own week.

export function canDecideTimesheet(db: DbLike, user: ScopeUser, employeeId: number): boolean {
  return canDecideFor(db, user, employeeId, TIMESHEET_APPROVAL);
}

const weekLabel = (weekStart: ISODate) => formatDate(weekStart, { day: "numeric", month: "short" });

function loggedMinutes(db: DbLike, timesheetId: number): number {
  return (
    db
      .select({ n: sql<number>`coalesce(sum(${timesheetEntries.minutes}), 0)` })
      .from(timesheetEntries)
      .where(eq(timesheetEntries.timesheetId, timesheetId))
      .get()?.n ?? 0
  );
}

function notifyEmployee(db: DbLike, employeeId: number, n: { type: string; title: string; body?: string | null; link: string }): void {
  const login = db
    .select({ userId: employees.userId, status: users.status })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.id, employeeId))
    .get();
  if (login?.status === "active") notify(db, { userId: login.userId!, ...n });
}

export function submitTimesheet(
  db: DbLike,
  actor: SessionUser,
  weekStart: ISODate,
  { today, now }: { today: ISODate; now: Date },
): TimesheetRow {
  const employeeId = requireOwnEmployee(actor);
  const employee = requireEmployee(db, employeeId);
  if (weekStart > startOfWeek(today)) throw new DomainError("FUTURE_WEEK", "You can't submit a week that hasn't started yet.");
  const existing = findTimesheet(db, employeeId, weekStart);
  if (existing && !EDITABLE_STATUSES.includes(existing.status)) {
    throw new DomainError("NOT_EDITABLE", existing.status === "approved" ? "This week is already approved." : "This week is already submitted.");
  }
  const end = weekDates(weekStart)[6]!;
  const minutes = existing ? loggedMinutes(db, existing.id) : 0;
  if (minutes === 0 && availableMinutes(db, employeeId, weekStart, end) > 0) {
    throw new DomainError("EMPTY_WEEK", "Log your time for the week before submitting it.");
  }
  const timer = db.select().from(runningTimers).where(eq(runningTimers.employeeId, employeeId)).get();
  if (timer) {
    const started = dateInTimeZone(new Date(timer.startedAt), getSetting(db, "locale").timezone);
    if (started >= weekStart && started <= end) throw new DomainError("TIMER_RUNNING", "Stop the running timer before submitting this week.");
  }
  const timesheet = existing ?? db.insert(timesheets).values({ employeeId, weekStart }).returning().get();
  const submitted = db
    .update(timesheets)
    .set({ status: "submitted", submittedAt: now.toISOString(), approverId: null, decidedAt: null, decisionNote: null })
    .where(eq(timesheets.id, timesheet.id))
    .returning()
    .get()!;
  notifyMany(db, approverUserIdsFor(db, employeeId, TIMESHEET_APPROVAL), {
    type: "timesheet.submitted",
    title: `${employee.displayName} submitted the timesheet for the week of ${weekLabel(weekStart)} (${formatHours(minutes)} h)`,
    link: "/approvals?tab=timesheets",
  });
  return submitted;
}

function requireTimesheet(db: DbLike, id: number): TimesheetRow {
  const row = db.select().from(timesheets).where(eq(timesheets.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Timesheet not found.");
  return row;
}

/** The employee pulls back a submitted week before anyone decides on it. */
export function withdrawTimesheet(db: DbLike, actor: SessionUser, timesheetId: number): TimesheetRow {
  const timesheet = requireTimesheet(db, timesheetId);
  if (timesheet.employeeId !== actor.employeeId) throw new DomainError("FORBIDDEN", "You can only withdraw your own timesheets.");
  if (timesheet.status !== "submitted") throw new DomainError("NOT_PENDING", "Only a submitted week waiting for a decision can be withdrawn.");
  return db.update(timesheets).set({ status: "draft", submittedAt: null }).where(eq(timesheets.id, timesheetId)).returning().get()!;
}

function requirePending(db: DbLike, actor: SessionUser, timesheetId: number): TimesheetRow {
  const timesheet = requireTimesheet(db, timesheetId);
  if (timesheet.status !== "submitted") throw new DomainError("NOT_PENDING", "This timesheet isn't waiting for a decision.");
  if (actor.employeeId === timesheet.employeeId) throw new DomainError("SELF_APPROVAL", "Someone else has to decide on your own timesheet.");
  if (!canDecideTimesheet(db, actor, timesheet.employeeId)) {
    throw new DomainError("FORBIDDEN", "You can only decide timesheets of people who report to you.");
  }
  return timesheet;
}

export function approveTimesheet(db: DbLike, actor: SessionUser, timesheetId: number, note: string | null): TimesheetRow {
  const timesheet = requirePending(db, actor, timesheetId);
  const approved = db
    .update(timesheets)
    .set({ status: "approved", approverId: actor.id, decidedAt: new Date().toISOString(), decisionNote: note })
    .where(eq(timesheets.id, timesheetId))
    .returning()
    .get()!;
  notifyEmployee(db, timesheet.employeeId, {
    type: "timesheet.approved",
    title: `Your timesheet for the week of ${weekLabel(timesheet.weekStart)} was approved`,
    body: note,
    link: `/me/timesheets/${timesheet.weekStart}`,
  });
  return approved;
}

/** A rejected week goes back to the employee to fix and resubmit, so it needs a reason. */
export function rejectTimesheet(db: DbLike, actor: SessionUser, timesheetId: number, note: string | null): TimesheetRow {
  const timesheet = requirePending(db, actor, timesheetId);
  if (!note || note.trim().length < 3) throw new DomainError("NOTE_REQUIRED", "Say what needs fixing.", { note: ["Say what needs fixing"] });
  const rejected = db
    .update(timesheets)
    .set({ status: "rejected", approverId: actor.id, decidedAt: new Date().toISOString(), decisionNote: note })
    .where(eq(timesheets.id, timesheetId))
    .returning()
    .get()!;
  notifyEmployee(db, timesheet.employeeId, {
    type: "timesheet.rejected",
    title: `Your timesheet for the week of ${weekLabel(timesheet.weekStart)} needs changes`,
    body: note,
    link: `/me/timesheets/${timesheet.weekStart}`,
  });
  return rejected;
}

export function bulkApproveTimesheets(
  db: DbLike,
  actor: SessionUser,
  timesheetIds: number[],
  note: string | null,
): { approved: number[]; failed: { id: number; error: string }[] } {
  const result: { approved: number[]; failed: { id: number; error: string }[] } = { approved: [], failed: [] };
  for (const id of timesheetIds) {
    try {
      db.transaction((tx) => approveTimesheet(tx, actor, id, note));
      result.approved.push(id);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      result.failed.push({ id, error: err.message });
    }
  }
  return result;
}
