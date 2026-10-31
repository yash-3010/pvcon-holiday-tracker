import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import { addDays, startOfWeek, type ISODate } from "@/lib/dates";
import { EDITABLE_STATUSES, utilization, weekDates, type TimesheetStatus } from "@/lib/timesheets";
import type { DbLike } from "@/server/db/client";
import {
  attendanceDays, clients, employees, projects, taskCategories, timesheetEntries, timesheets, users, type TimesheetRow,
} from "@/server/db/schema";
import { clockState } from "@/server/modules/attendance/punches";
import { shiftForEmployee } from "@/server/modules/attendance/shifts";
import type { ScopeUser } from "@/server/modules/employees/scope";
import { workCalendar, type WorkDay } from "./availability";
import { allowedProjects, canDecideTimesheet } from "./service";
import { runningTimer } from "./timer";

/** Logged time per timesheet: total and billable minutes. */
function sums(db: DbLike, timesheetIds: number[]): Map<number, { logged: number; billable: number }> {
  if (timesheetIds.length === 0) return new Map();
  return new Map(
    db
      .select({
        id: timesheetEntries.timesheetId,
        logged: sql<number>`sum(${timesheetEntries.minutes})`,
        billable: sql<number>`sum(case when ${timesheetEntries.billable} then ${timesheetEntries.minutes} else 0 end)`,
      })
      .from(timesheetEntries)
      .where(inArray(timesheetEntries.timesheetId, timesheetIds))
      .groupBy(timesheetEntries.timesheetId)
      .all()
      .map((r) => [r.id, { logged: r.logged, billable: r.billable }]),
  );
}

export interface WeekSummary {
  weekStart: ISODate;
  timesheetId: number | null;
  status: TimesheetStatus;
  loggedMinutes: number;
  billableMinutes: number;
  availableMinutes: number;
}

/** The last `count` weeks, newest first; a week never saved reads as an empty draft. Weeks before joining are left out. */
export function myWeeks(db: DbLike, employeeId: number, { today, count = 12 }: { today: ISODate; count?: number }): WeekSummary[] {
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!employee) return [];
  const current = startOfWeek(today);
  const starts = Array.from({ length: count }, (_, i) => addDays(current, -7 * i)).filter((w) => addDays(w, 6) >= employee.dateOfJoining);
  if (starts.length === 0) return [];
  const oldest = starts.at(-1)!;
  const stored = new Map(
    db
      .select()
      .from(timesheets)
      .where(and(eq(timesheets.employeeId, employeeId), gte(timesheets.weekStart, oldest), lte(timesheets.weekStart, current)))
      .all()
      .map((t) => [t.weekStart, t]),
  );
  const totals = sums(db, [...stored.values()].map((t) => t.id));
  const available = new Map<ISODate, number>();
  for (const day of workCalendar(db, employeeId, oldest, addDays(current, 6))) {
    const week = startOfWeek(day.date);
    available.set(week, (available.get(week) ?? 0) + day.availableMinutes);
  }
  return starts.map((weekStart) => {
    const t = stored.get(weekStart);
    const s = t ? totals.get(t.id) : undefined;
    return {
      weekStart, timesheetId: t?.id ?? null, status: t?.status ?? "draft", loggedMinutes: s?.logged ?? 0, billableMinutes: s?.billable ?? 0,
      availableMinutes: available.get(weekStart) ?? 0,
    };
  });
}

export function employeeTimesheetSummary(db: DbLike, employeeId: number, { today }: { today: ISODate }): WeekSummary[] {
  return myWeeks(db, employeeId, { today, count: 8 });
}

/** The dashboard card: this week so far. */
export function weekCard(db: DbLike, employeeId: number, { today }: { today: ISODate }) {
  const week = myWeeks(db, employeeId, { today, count: 1 })[0];
  if (!week) return null;
  return { ...week, ...utilization({ availableMinutes: week.availableMinutes, loggedMinutes: week.loggedMinutes, billableMinutes: week.billableMinutes }) };
}

export interface WeekDay extends WorkDay {
  loggedMinutes: number;
  /** Attendance worked time for reference; null on auto-mode shifts, future days and days not recorded. */
  workedMinutes: number | null;
  /** Logged and worked differ by more than an hour on a past day. */
  flag: boolean;
}

export interface WeekRow {
  projectId: number;
  projectCode: string;
  projectName: string;
  clientName: string | null;
  taskCategoryId: number;
  categoryName: string;
  billable: boolean;
  notes: string;
  minutes: Record<ISODate, number>;
}

export interface WeekDetail {
  weekStart: ISODate;
  timesheetId: number | null;
  /** The week's `updated_at`, sent back when saving so a stale grid can't overwrite the clock's time. */
  version: string | null;
  status: TimesheetStatus;
  /** Draft or rejected, and not a future week. */
  editable: boolean;
  submittedAt: string | null;
  decision: { by: string | null; note: string | null; at: string } | null;
  days: WeekDay[];
  rows: WeekRow[];
  totals: { loggedMinutes: number; billableMinutes: number; availableMinutes: number; utilizationPct: number | null; billablePct: number | null };
  timer: { projectId: number; projectCode: string; projectName: string; taskCategoryId: number; categoryName: string; notes: string | null; startedAt: string } | null;
  options: {
    projects: { id: number; code: string; name: string; clientName: string | null; billableDefault: boolean }[];
    categories: { id: number; name: string; billableDefault: boolean }[];
  };
}

/** Everything the weekly grid shows (spec §5.3): rows, the calendar, attendance for reference, and what can be added. */
export function weekDetail(db: DbLike, employeeId: number, weekStart: ISODate, { today, now }: { today: ISODate; now: Date }): WeekDetail {
  const dates = weekDates(weekStart);
  const timesheet: TimesheetRow | undefined = db
    .select()
    .from(timesheets)
    .where(and(eq(timesheets.employeeId, employeeId), eq(timesheets.weekStart, weekStart)))
    .get();
  const entries = timesheet
    ? db
        .select({
          entry: timesheetEntries, projectCode: projects.code, projectName: projects.name, clientName: clients.name,
          categoryName: taskCategories.name, categoryOrder: taskCategories.sortOrder,
        })
        .from(timesheetEntries)
        .innerJoin(projects, eq(projects.id, timesheetEntries.projectId))
        .leftJoin(clients, eq(clients.id, projects.clientId))
        .innerJoin(taskCategories, eq(taskCategories.id, timesheetEntries.taskCategoryId))
        .where(eq(timesheetEntries.timesheetId, timesheet.id))
        .orderBy(asc(projects.code), asc(taskCategories.sortOrder), asc(timesheetEntries.date))
        .all()
    : [];

  const rows = new Map<string, WeekRow>();
  for (const { entry: e, ...names } of entries) {
    const key = `${e.projectId}:${e.taskCategoryId}`;
    const row =
      rows.get(key) ??
      rows
        .set(key, {
          projectId: e.projectId, projectCode: names.projectCode, projectName: names.projectName, clientName: names.clientName,
          taskCategoryId: e.taskCategoryId, categoryName: names.categoryName, billable: e.billable, notes: e.notes ?? "", minutes: {},
        })
        .get(key)!;
    row.minutes[e.date] = e.minutes;
  }

  const punchMode = shiftForEmployee(db, employeeId).attendanceMode === "punch";
  const attendance = new Map(
    db
      .select({ date: attendanceDays.date, worked: attendanceDays.workedMinutes })
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employeeId), gte(attendanceDays.date, dates[0]!), lte(attendanceDays.date, dates[6]!)))
      .all()
      .map((r) => [r.date, r.worked]),
  );
  const todayWorked = punchMode && dates.includes(today) ? clockState(db, employeeId, now).todayWorkedMinutes : null;
  const days = workCalendar(db, employeeId, dates[0]!, dates[6]!).map((day): WeekDay => {
    const logged = entries.filter((e) => e.entry.date === day.date).reduce((s, e) => s + e.entry.minutes, 0);
    const worked = !punchMode || day.date > today ? null : day.date === today ? todayWorked : (attendance.get(day.date) ?? null);
    return { ...day, loggedMinutes: logged, workedMinutes: worked, flag: worked !== null && day.date < today && Math.abs(logged - worked) > 60 };
  });

  const loggedMinutes = entries.reduce((s, e) => s + e.entry.minutes, 0);
  const billableMinutes = entries.reduce((s, e) => s + (e.entry.billable ? e.entry.minutes : 0), 0);
  const availableMinutes = days.reduce((s, d) => s + d.availableMinutes, 0);
  const status = timesheet?.status ?? "draft";

  const decidedBy = timesheet?.approverId
    ? (db.select({ name: users.name }).from(users).where(eq(users.id, timesheet.approverId)).get()?.name ?? null)
    : null;
  const timerRow = runningTimer(db, employeeId);
  const timerNames = timerRow
    ? db
        .select({ projectCode: projects.code, projectName: projects.name, categoryName: taskCategories.name })
        .from(projects)
        .innerJoin(taskCategories, eq(taskCategories.id, timerRow.taskCategoryId))
        .where(eq(projects.id, timerRow.projectId))
        .get()
    : undefined;

  // What can be added: projects open on any past day of the week, plus those already in it.
  const projectIds = new Set([...rows.values()].map((r) => r.projectId));
  for (const date of dates.filter((d) => d <= today)) for (const p of allowedProjects(db, employeeId, date)) projectIds.add(p.id);
  if (startOfWeek(today) === weekStart) for (const p of allowedProjects(db, employeeId, today)) projectIds.add(p.id);
  const projectOptions = projectIds.size
    ? db
        .select({ id: projects.id, code: projects.code, name: projects.name, clientName: clients.name, billableDefault: projects.billableDefault })
        .from(projects)
        .leftJoin(clients, eq(clients.id, projects.clientId))
        .where(inArray(projects.id, [...projectIds]))
        .orderBy(asc(projects.code))
        .all()
    : [];
  const usedCategories = new Set([...rows.values()].map((r) => r.taskCategoryId));
  const categoryOptions = db
    .select({ id: taskCategories.id, name: taskCategories.name, billableDefault: taskCategories.billableDefault, archived: taskCategories.archived })
    .from(taskCategories)
    .orderBy(asc(taskCategories.sortOrder), asc(taskCategories.name))
    .all()
    .filter((c) => !c.archived || usedCategories.has(c.id))
    .map(({ archived: _archived, ...c }) => c);

  return {
    weekStart,
    timesheetId: timesheet?.id ?? null,
    version: timesheet?.updatedAt ?? null,
    status,
    editable: EDITABLE_STATUSES.includes(status) && weekStart <= startOfWeek(today),
    submittedAt: timesheet?.submittedAt ?? null,
    decision: timesheet?.decidedAt ? { by: decidedBy, note: timesheet.decisionNote, at: timesheet.decidedAt } : null,
    days,
    rows: [...rows.values()],
    totals: { loggedMinutes, billableMinutes, availableMinutes, ...utilization({ availableMinutes, loggedMinutes, billableMinutes }) },
    timer:
      timerRow && timerNames
        ? {
            projectId: timerRow.projectId, projectCode: timerNames.projectCode, projectName: timerNames.projectName,
            taskCategoryId: timerRow.taskCategoryId, categoryName: timerNames.categoryName, notes: timerRow.notes, startedAt: timerRow.startedAt,
          }
        : null,
    options: { projects: projectOptions, categories: categoryOptions },
  };
}

export interface PendingTimesheet {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  weekStart: ISODate;
  submittedAt: string | null;
  loggedMinutes: number;
  billableMinutes: number;
  availableMinutes: number;
  /** Past days where logged and attendance differ by more than an hour. */
  flaggedDays: number;
  /** Days of approved leave in the week (a half day counts ½). */
  leaveDays: number;
}

/** Submitted timesheets `user` can decide, oldest first. */
export function pendingTimesheetsFor(db: DbLike, user: ScopeUser, { today, now }: { today: ISODate; now: Date }): PendingTimesheet[] {
  if (!can(user, "timesheet.approve")) return [];
  const pending = db
    .select({ timesheet: timesheets, employeeName: employees.displayName, employeeCode: employees.employeeCode })
    .from(timesheets)
    .innerJoin(employees, eq(employees.id, timesheets.employeeId))
    .where(eq(timesheets.status, "submitted"))
    .orderBy(asc(timesheets.submittedAt), asc(timesheets.id))
    .all()
    .filter((r) => canDecideTimesheet(db, user, r.timesheet.employeeId));
  const totals = sums(db, pending.map((r) => r.timesheet.id));
  return pending.map(({ timesheet: t, employeeName, employeeCode }) => {
    const week = weekDetail(db, t.employeeId, t.weekStart, { today, now });
    return {
      id: t.id, employeeId: t.employeeId, employeeName, employeeCode, weekStart: t.weekStart, submittedAt: t.submittedAt,
      loggedMinutes: totals.get(t.id)?.logged ?? 0, billableMinutes: totals.get(t.id)?.billable ?? 0,
      availableMinutes: week.totals.availableMinutes,
      flaggedDays: week.days.filter((d) => d.flag).length,
      leaveDays: week.days.reduce((s, d) => s + (d.kind === "leave" ? 1 : d.kind === "half_leave" ? 0.5 : 0), 0),
    };
  });
}

/** A week opened from the approvals inbox or a profile: the employee, approvers above them, and org-wide viewers. */
export function timesheetDetailForApprover(
  db: DbLike,
  user: ScopeUser,
  timesheetId: number,
  opts: { today: ISODate; now: Date },
): { employeeName: string; week: WeekDetail } | null {
  const row = db
    .select({ timesheet: timesheets, employeeName: employees.displayName })
    .from(timesheets)
    .innerJoin(employees, eq(employees.id, timesheets.employeeId))
    .where(eq(timesheets.id, timesheetId))
    .get();
  if (!row) return null;
  const { employeeId, weekStart } = row.timesheet;
  const allowed = user.employeeId === employeeId || can(user, "timesheet.view.all") || canDecideTimesheet(db, user, employeeId);
  return allowed ? { employeeName: row.employeeName, week: weekDetail(db, employeeId, weekStart, opts) } : null;
}
