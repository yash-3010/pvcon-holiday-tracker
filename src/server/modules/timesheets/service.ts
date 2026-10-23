import { and, asc, eq, gte, isNull, lte, or } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/types";
import { dayOfWeek, formatDate, startOfWeek, type ISODate } from "@/lib/dates";
import { WEEKDAY_LABELS } from "@/lib/leave";
import { DAY_MINUTES, EDITABLE_STATUSES, weekDates } from "@/lib/timesheets";
import type { WeekSaveInput } from "@/lib/validation/timesheets";
import type { DbLike } from "@/server/db/client";
import {
  projectMembers, projects, taskCategories, timesheetEntries, timesheets, type ProjectRow, type TimesheetRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { requireEmployee } from "@/server/modules/employees/service";
import { workCalendar } from "./availability";

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
