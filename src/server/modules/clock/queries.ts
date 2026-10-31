import { asc, desc, eq, inArray } from "drizzle-orm";
import type { WorkMode } from "@/lib/attendance";
import type { ClockStateName } from "@/lib/clock";
import { startOfWeek, type ISODate } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import { attendancePunches, projects, taskCategories } from "@/server/db/schema";
import { clockState } from "@/server/modules/attendance/punches";
import { shiftForEmployee } from "@/server/modules/attendance/shifts";
import { allowedProjects, findTimesheet } from "@/server/modules/timesheets/service";
import { runningTimer } from "@/server/modules/timesheets/timer";
import { defaultSelection } from "./service";

/** What the clock in the top bar, the dashboard and the pop-out show, read at `readAt` (serializable). */
export interface ClockSnapshot {
  /** Server epoch milliseconds of the reading; the browser counts on from its own receipt of it. */
  readAt: number;
  date: ISODate;
  state: ClockStateName;
  /** The current work mode, or the one to start with (the last used). */
  workMode: WorkMode;
  sessionStartedAt: string | null;
  breakStartedAt: string | null;
  firstInAt: string | null;
  endedAt: string | null;
  workedSeconds: number;
  breakSeconds: number;
  /** What the clock is logging time to right now. */
  logging: { projectId: number; taskCategoryId: number; label: string; notes: string | null; startedAt: string } | null;
  /** What it will log to on the next clock-in or resume. */
  selection: { projectId: number; taskCategoryId: number; label: string; notes: string | null } | null;
  projects: { id: number; label: string }[];
  categories: { id: number; label: string }[];
  /** Why time can't reach this week's timesheet, if it can't. */
  blocked: string | null;
  shift: { name: string; times: string; fullDayMinutes: number; auto: boolean };
}

const projectLabel = (p: { code: string; name: string }) => `${p.code} · ${p.name}`;

export function clockSnapshot(db: DbLike, employeeId: number, now: Date): ClockSnapshot {
  const state = clockState(db, employeeId, now);
  const { day } = state;
  const shift = shiftForEmployee(db, employeeId);
  const open = allowedProjects(db, employeeId, state.date);
  const categories = db.select().from(taskCategories).where(eq(taskCategories.archived, false)).orderBy(asc(taskCategories.sortOrder), asc(taskCategories.name)).all();

  const timer = runningTimer(db, employeeId);
  const selection = defaultSelection(db, employeeId, state.date);
  const ids = [timer?.projectId, selection?.projectId].filter((id): id is number => id !== undefined);
  const named = new Map(
    (ids.length ? db.select().from(projects).where(inArray(projects.id, ids)).all() : []).map((p) => [p.id, projectLabel(p)]),
  );
  const categoryName = (id: number) =>
    categories.find((c) => c.id === id)?.name ?? db.select({ name: taskCategories.name }).from(taskCategories).where(eq(taskCategories.id, id)).get()?.name ?? "";
  const label = (projectId: number, taskCategoryId: number) => `${named.get(projectId) ?? ""} · ${categoryName(taskCategoryId)}`;

  const week = findTimesheet(db, employeeId, startOfWeek(state.date));
  const blocked =
    week && week.status !== "draft" && week.status !== "rejected"
      ? `This week's timesheet is ${week.status}, so the clock can't add time to it.`
      : open.length === 0
        ? "You're not on any project yet, so time isn't going to a timesheet."
        : null;
  const lastMode = db
    .select({ workMode: attendancePunches.workMode })
    .from(attendancePunches)
    .where(eq(attendancePunches.employeeId, employeeId))
    .orderBy(desc(attendancePunches.at), desc(attendancePunches.id))
    .get()?.workMode;

  return {
    readAt: now.getTime(),
    date: state.date,
    state: day.state,
    workMode: state.workMode ?? lastMode ?? "office",
    sessionStartedAt: day.sessionStartedAt,
    breakStartedAt: day.breakStartedAt,
    firstInAt: day.firstInAt,
    endedAt: day.endedAt,
    workedSeconds: day.workedSeconds,
    breakSeconds: day.breakSeconds,
    logging: timer
      ? { projectId: timer.projectId, taskCategoryId: timer.taskCategoryId, label: label(timer.projectId, timer.taskCategoryId), notes: timer.notes, startedAt: timer.startedAt }
      : null,
    selection: selection ? { ...selection, label: label(selection.projectId, selection.taskCategoryId) } : null,
    projects: open.map((p) => ({ id: p.id, label: projectLabel(p) })),
    categories: categories.map((c) => ({ id: c.id, label: c.name })),
    blocked,
    shift: { name: shift.name, times: `${shift.startTime}–${shift.endTime}`, fullDayMinutes: shift.fullDayMinutes, auto: shift.attendanceMode === "auto" },
  };
}
