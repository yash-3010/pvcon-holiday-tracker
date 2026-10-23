import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  ATTENDANCE_CODES, compOffDaysFor, type AttendanceStatus, type PunchDirection, type PunchSource, type WorkMode,
} from "@/lib/attendance";
import { can } from "@/lib/auth/permissions";
import { dateInTimeZone, dayOfWeek, diffDays, eachDay, formatHm, minutesInZone, monthRange, parseHm, type ISODate, type Period } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import {
  attendanceDays, attendancePunches, compOffClaims, departments, employees, leaveRequests, leaveTypes, regularizationRequests, users,
  type AttendanceDayRow, type ShiftRow,
} from "@/server/db/schema";
import { getReportingTree, type ScopeUser } from "@/server/modules/employees/scope";
import { holidaysForEmployee } from "@/server/modules/holidays/service";
import { getSetting } from "@/server/modules/settings/service";
import { compOffThresholds } from "@/server/modules/compoff/service";
import { canDecideRegularization } from "./regularization";
import { clockState } from "./punches";
import { shiftForEmployee } from "./shifts";

const CURRENT = inArray(employees.status, ["active", "on_notice"]);
const LIVE_STATUSES: readonly AttendanceStatus[] = ["present", "half_day", "absent"];

/** Today's punch-based status is still changing; it isn't shown as a result or counted until the day closes. */
export function isProvisional(date: ISODate, today: ISODate, status: AttendanceStatus): boolean {
  return date === today && LIVE_STATUSES.includes(status);
}

function emptyCounts(): Record<AttendanceStatus, number> {
  return { present: 0, half_day: 0, absent: 0, on_leave: 0, half_leave: 0, holiday: 0, weekly_off: 0, not_joined: 0, exited: 0 };
}

export interface MyAttendanceDay {
  date: ISODate;
  weekday: number;
  isToday: boolean;
  isFuture: boolean;
  /** null for future days, days not computed yet, and today while it is still running. */
  status: AttendanceStatus | null;
  firstIn: number | null;
  lastOut: number | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  overtimeMinutes: number;
  offDayWorked: boolean;
  overridden: boolean;
  locked: boolean;
  holiday: string | null;
  leaveCode: string | null;
  punches: { time: string; direction: PunchDirection; source: PunchSource; workMode: WorkMode }[];
  regularization: { id: number; status: string; requestedIn: number; requestedOut: number } | null;
  canRegularize: boolean;
  compOff: { eligibleDays: 0 | 0.5 | 1; claim: { id: number; status: string } | null; canClaim: boolean } | null;
}

/** The employee's month (spec §5.2): one entry per day with what happened and what they can still do about it. */
export function myAttendanceMonth(
  db: DbLike,
  employeeId: number,
  month: Period,
  now: Date,
): { days: MyAttendanceDay[]; summary: Record<AttendanceStatus, number> & { workedMinutes: number } } {
  const timeZone = getSetting(db, "locale").timezone;
  const today = dateInTimeZone(now, timeZone);
  const { start, end } = monthRange(month);
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get()!;
  const windowDays = getSetting(db, "attendance").regularizationWindowDays;
  const compOffOn = getSetting(db, "compOff");
  const thresholds = compOffThresholds(db, employeeId);

  const rows = new Map(
    db
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employeeId), gte(attendanceDays.date, start), lte(attendanceDays.date, end)))
      .all()
      .map((r) => [r.date, r]),
  );
  const punches = db
    .select()
    .from(attendancePunches)
    .where(and(eq(attendancePunches.employeeId, employeeId), gte(attendancePunches.date, start), lte(attendancePunches.date, end)))
    .orderBy(asc(attendancePunches.at))
    .all();
  const holidays = new Map(holidaysForEmployee(db, employeeId, start, end).map((h) => [h.date, h.name]));
  const leaveCodes = new Map(
    db
      .select({ startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, code: leaveTypes.code })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, end), gte(leaveRequests.endDate, start)))
      .all()
      .flatMap((r) => eachDay(r.startDate, r.endDate).map((d) => [d, r.code] as const)),
  );
  const regs = new Map<ISODate, MyAttendanceDay["regularization"]>();
  for (const r of db
    .select()
    .from(regularizationRequests)
    .where(and(eq(regularizationRequests.employeeId, employeeId), gte(regularizationRequests.date, start), lte(regularizationRequests.date, end)))
    .orderBy(asc(regularizationRequests.id))
    .all()) {
    regs.set(r.date, { id: r.id, status: r.status, requestedIn: r.requestedIn, requestedOut: r.requestedOut });
  }
  const claims = new Map(
    db
      .select({ id: compOffClaims.id, date: compOffClaims.workedDate, status: compOffClaims.status })
      .from(compOffClaims)
      .where(and(eq(compOffClaims.employeeId, employeeId), gte(compOffClaims.workedDate, start), lte(compOffClaims.workedDate, end)))
      .orderBy(asc(compOffClaims.id))
      .all()
      .map((c) => [c.date, { id: c.id, status: c.status }]),
  );
  const live = clockState(db, employeeId, now);

  const summary = { ...emptyCounts(), workedMinutes: 0 };
  const days = eachDay(start, end).map((date): MyAttendanceDay => {
    const row = rows.get(date);
    const isToday = date === today;
    const isFuture = date > today;
    const status = row && !isProvisional(date, today, row.status) ? row.status : null;
    if (status && !isToday) {
      summary[status] += 1;
      summary.workedMinutes += row!.workedMinutes;
    }
    const reg = regs.get(date) ?? null;
    const employed = date >= employee.dateOfJoining && (!employee.lastWorkingDate || date <= employee.lastWorkingDate);
    const claim = claims.get(date) ?? null;
    const eligibleDays = row?.offDayWorked && date < today ? compOffDaysFor(row.workedMinutes, thresholds) : 0;
    return {
      date,
      weekday: dayOfWeek(date),
      isToday,
      isFuture,
      status,
      firstIn: row?.firstIn ?? null,
      lastOut: row?.lastOut ?? null,
      workedMinutes: isToday ? live.todayWorkedMinutes : (row?.workedMinutes ?? 0),
      lateMinutes: row?.lateMinutes ?? 0,
      earlyMinutes: row?.earlyMinutes ?? 0,
      overtimeMinutes: row?.overtimeMinutes ?? 0,
      offDayWorked: row?.offDayWorked ?? false,
      overridden: !!row?.overrideStatus,
      locked: row?.locked ?? false,
      holiday: holidays.get(date) ?? null,
      leaveCode: leaveCodes.get(date) ?? null,
      punches: punches
        .filter((p) => p.date === date)
        .map((p) => ({ time: formatHm(minutesInZone(new Date(p.at), timeZone)), direction: p.direction, source: p.source, workMode: p.workMode })),
      regularization: reg,
      canRegularize:
        employed && date < today && diffDays(date, today) <= windowDays && !row?.locked && reg?.status !== "pending",
      compOff:
        compOffOn.enabled && (eligibleDays > 0 || claim)
          ? {
              eligibleDays,
              claim,
              canClaim:
                eligibleDays > 0 && diffDays(date, today) <= compOffOn.claimWindowDays && (!claim || claim.status === "rejected" || claim.status === "withdrawn"),
            }
          : null,
    };
  });
  return { days, summary };
}

/** Employee ids whose attendance `user` may see: everyone for org-wide viewers, the reporting tree for approvers. */
function attendanceScope(db: DbLike, user: ScopeUser): "all" | number[] {
  if (can(user, "attendance.view.all")) return "all";
  if (!can(user, "regularization.approve") || user.employeeId === null) return [];
  return getReportingTree(db, user.employeeId);
}

function scopedEmployees(db: DbLike, user: ScopeUser, departmentId?: number) {
  const scope = attendanceScope(db, user);
  if (scope !== "all" && scope.length === 0) return [];
  return db
    .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode, department: departments.name })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(
      and(
        CURRENT,
        scope === "all" ? undefined : inArray(employees.id, scope),
        departmentId ? eq(employees.departmentId, departmentId) : undefined,
      ),
    )
    .orderBy(asc(employees.id))
    .all();
}

export type BoardState = "in" | "out" | "on_leave" | "holiday" | "weekly_off" | "not_in";

export interface TodayBoardRow {
  employeeId: number;
  name: string;
  code: string;
  department: string | null;
  state: BoardState;
  workMode: WorkMode | null;
  firstIn: string | null;
  late: boolean;
  workedMinutes: number;
}

/** Who is in, remote, late, on leave or not in yet today (spec §5.2 admin views). */
export function todayBoard(db: DbLike, user: ScopeUser, now: Date): { rows: TodayBoardRow[]; totals: Record<"in" | "remote" | "late" | "onLeave" | "notIn" | "off", number> } {
  const timeZone = getSetting(db, "locale").timezone;
  const today = dateInTimeZone(now, timeZone);
  const people = scopedEmployees(db, user);
  const ids = people.map((p) => p.id);
  const totals = { in: 0, remote: 0, late: 0, onLeave: 0, notIn: 0, off: 0 };
  if (ids.length === 0) return { rows: [], totals };

  const punches = db
    .select()
    .from(attendancePunches)
    .where(and(inArray(attendancePunches.employeeId, ids), eq(attendancePunches.date, today)))
    .orderBy(asc(attendancePunches.at))
    .all();
  const onLeave = new Set(
    db
      .select({ employeeId: leaveRequests.employeeId })
      .from(leaveRequests)
      .where(and(inArray(leaveRequests.employeeId, ids), eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, today), gte(leaveRequests.endDate, today), eq(leaveRequests.startHalf, "full")))
      .all()
      .map((r) => r.employeeId),
  );

  const rows = people.map((p): TodayBoardRow => {
    const mine = punches.filter((x) => x.employeeId === p.id);
    const shift: ShiftRow = shiftForEmployee(db, p.id);
    const state = clockState(db, p.id, now);
    const first = mine.find((x) => x.direction === "in");
    const firstMinutes = first ? minutesInZone(new Date(first.at), timeZone) : null;
    const holiday = holidaysForEmployee(db, p.id, today, today).length > 0;
    const weeklyOff = shift.weeklyOffs.includes(dayOfWeek(today));
    let boardState: BoardState;
    if (state.state === "in") boardState = "in";
    else if (onLeave.has(p.id)) boardState = "on_leave";
    else if (mine.length > 0) boardState = "out";
    else if (holiday) boardState = "holiday";
    else if (weeklyOff) boardState = "weekly_off";
    else boardState = "not_in";
    const late = !holiday && !weeklyOff && firstMinutes !== null && firstMinutes > parseHm(shift.startTime) + shift.graceMinutes;
    if (boardState === "in") totals.in += 1;
    if (boardState === "in" && state.workMode === "remote") totals.remote += 1;
    if (late) totals.late += 1;
    if (boardState === "on_leave") totals.onLeave += 1;
    if (boardState === "not_in") totals.notIn += 1;
    if (boardState === "holiday" || boardState === "weekly_off") totals.off += 1;
    return {
      employeeId: p.id, name: p.name, code: p.code, department: p.department, state: boardState,
      workMode: state.state === "in" ? state.workMode : (mine.at(-1)?.workMode ?? null),
      firstIn: firstMinutes === null ? null : formatHm(firstMinutes), late, workedMinutes: state.todayWorkedMinutes,
    };
  });
  return { rows, totals };
}

export interface MusterCell {
  status: AttendanceStatus;
  code: string;
  overridden: boolean;
  locked: boolean;
  /** Today's punch-based result, still changing. */
  provisional: boolean;
}

export interface MusterRoll {
  month: Period;
  days: { date: ISODate; weekday: number }[];
  rows: {
    employee: { id: number; name: string; code: string; department: string | null };
    cells: Record<ISODate, MusterCell>;
    totals: Record<AttendanceStatus, number>;
  }[];
}

/** Employees × days with status codes (spec §5.2), for the people `user` may see. */
export function musterRoll(db: DbLike, user: ScopeUser, month: Period, { departmentId }: { departmentId?: number }, now: Date = new Date()): MusterRoll {
  const today = dateInTimeZone(now, getSetting(db, "locale").timezone);
  const { start, end } = monthRange(month);
  const days = eachDay(start, end).map((date) => ({ date, weekday: dayOfWeek(date) }));
  const people = scopedEmployees(db, user, departmentId);
  if (people.length === 0) return { month, days, rows: [] };
  const all = db
    .select()
    .from(attendanceDays)
    .where(and(inArray(attendanceDays.employeeId, people.map((p) => p.id)), gte(attendanceDays.date, start), lte(attendanceDays.date, end)))
    .all();
  const byEmployee = new Map<number, AttendanceDayRow[]>();
  for (const row of all) byEmployee.set(row.employeeId, [...(byEmployee.get(row.employeeId) ?? []), row]);
  return {
    month,
    days,
    rows: people.map((employee) => {
      const cells: Record<ISODate, MusterCell> = {};
      const totals = emptyCounts();
      for (const row of byEmployee.get(employee.id) ?? []) {
        const provisional = isProvisional(row.date, today, row.status);
        cells[row.date] = { status: row.status, code: ATTENDANCE_CODES[row.status], overridden: !!row.overrideStatus, locked: row.locked, provisional };
        if (!provisional) totals[row.status] += 1;
      }
      return { employee, cells, totals };
    }),
  };
}

export interface PendingRegularization {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  date: ISODate;
  requestedIn: number;
  requestedOut: number;
  reason: string;
  createdAt: string;
  /** What the day looks like now, if it has been computed. */
  actual: { status: AttendanceStatus; firstIn: number | null; lastOut: number | null; workedMinutes: number } | null;
}

export function pendingRegularizationsFor(db: DbLike, user: ScopeUser): PendingRegularization[] {
  if (!can(user, "regularization.approve")) return [];
  return db
    .select({
      id: regularizationRequests.id, employeeId: regularizationRequests.employeeId, employeeName: employees.displayName,
      employeeCode: employees.employeeCode, date: regularizationRequests.date, requestedIn: regularizationRequests.requestedIn,
      requestedOut: regularizationRequests.requestedOut, reason: regularizationRequests.reason, createdAt: regularizationRequests.createdAt,
    })
    .from(regularizationRequests)
    .innerJoin(employees, eq(employees.id, regularizationRequests.employeeId))
    .where(eq(regularizationRequests.status, "pending"))
    .orderBy(asc(regularizationRequests.createdAt), asc(regularizationRequests.id))
    .all()
    .filter((r) => canDecideRegularization(db, user, r.employeeId))
    .map((r) => {
      const day = db
        .select()
        .from(attendanceDays)
        .where(and(eq(attendanceDays.employeeId, r.employeeId), eq(attendanceDays.date, r.date)))
        .get();
      return {
        ...r,
        actual: day ? { status: day.status, firstIn: day.firstIn, lastOut: day.lastOut, workedMinutes: day.workedMinutes } : null,
      };
    });
}

/** The profile Attendance tab: the shift, this month's counts and the latest days. */
export function employeeAttendanceSummary(db: DbLike, employeeId: number, month: Period, now: Date = new Date()) {
  const today = dateInTimeZone(now, getSetting(db, "locale").timezone);
  const shift = shiftForEmployee(db, employeeId);
  const { start, end } = monthRange(month);
  const rows = db
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employeeId), gte(attendanceDays.date, start), lte(attendanceDays.date, end)))
    .orderBy(desc(attendanceDays.date))
    .all();
  const settled = rows.filter((r) => !isProvisional(r.date, today, r.status));
  const counts = emptyCounts();
  for (const r of settled) counts[r.status] += 1;
  const assignedShiftId = db.select({ shiftId: employees.shiftId }).from(employees).where(eq(employees.id, employeeId)).get()?.shiftId ?? null;
  return { shift, assignedShiftId, counts, recent: settled.slice(0, 10) };
}

/** Whether `user` may see this employee's attendance: org-wide viewers, or approvers above them. */
export function canViewAttendanceOf(db: DbLike, user: ScopeUser, employeeId: number): boolean {
  const scope = attendanceScope(db, user);
  return scope === "all" || scope.includes(employeeId);
}

export interface AttendanceDayDetail {
  employee: { id: number; name: string; code: string };
  date: ISODate;
  row: Pick<
    AttendanceDayRow,
    "status" | "firstIn" | "lastOut" | "workedMinutes" | "lateMinutes" | "earlyMinutes" | "overtimeMinutes" | "offDayWorked" | "locked" | "overrideStatus" | "overrideNote" | "overrideAt"
  > | null;
  overrideBy: string | null;
  punches: { time: string; direction: PunchDirection; source: PunchSource; workMode: WorkMode; note: string | null }[];
  holiday: string | null;
}

/** One employee-day for the muster-roll dialog. */
export function attendanceDayDetail(db: DbLike, employeeId: number, date: ISODate): AttendanceDayDetail | null {
  const employee = db.select({ id: employees.id, name: employees.displayName, code: employees.employeeCode }).from(employees).where(eq(employees.id, employeeId)).get();
  if (!employee) return null;
  const timeZone = getSetting(db, "locale").timezone;
  const row = db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, date))).get();
  const overrideBy = row?.overrideBy
    ? (db.select({ name: users.name }).from(users).where(eq(users.id, row.overrideBy)).get()?.name ?? null)
    : null;
  return {
    employee,
    date,
    row: row
      ? {
          status: row.status, firstIn: row.firstIn, lastOut: row.lastOut, workedMinutes: row.workedMinutes, lateMinutes: row.lateMinutes,
          earlyMinutes: row.earlyMinutes, overtimeMinutes: row.overtimeMinutes, offDayWorked: row.offDayWorked, locked: row.locked,
          overrideStatus: row.overrideStatus, overrideNote: row.overrideNote, overrideAt: row.overrideAt,
        }
      : null,
    overrideBy,
    punches: db
      .select()
      .from(attendancePunches)
      .where(and(eq(attendancePunches.employeeId, employeeId), eq(attendancePunches.date, date)))
      .orderBy(asc(attendancePunches.at))
      .all()
      .map((p) => ({ time: formatHm(minutesInZone(new Date(p.at), timeZone)), direction: p.direction, source: p.source, workMode: p.workMode, note: p.note })),
    holiday: holidaysForEmployee(db, employeeId, date, date)[0]?.name ?? null,
  };
}

/** Current employees with the shift they are on (null = the default), for the assignment dialog. */
export function shiftAssignmentOptions(db: DbLike): { id: number; name: string; code: string; shiftId: number | null }[] {
  return db
    .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode, shiftId: employees.shiftId })
    .from(employees)
    .where(CURRENT)
    .orderBy(asc(employees.displayName))
    .all();
}
