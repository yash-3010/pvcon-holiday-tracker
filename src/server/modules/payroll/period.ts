import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { dayOfWeek, eachDay, monthRange, type ISODate } from "@/lib/dates";
import { leaveYearOf, requestPortions } from "@/lib/leave";
import type { Variable } from "@/lib/payroll/constants";
import { summarizeDays, type PayrollDay } from "@/lib/payroll/days";
import type { DbLike } from "@/server/db/client";
import { attendanceDays, compOffClaims, employees, leaveRequests, leaveTypes, type EmployeeRow } from "@/server/db/schema";
import { fillMissingAttendance, recomputeAttendance } from "@/server/modules/attendance/compute";
import { isProvisional } from "@/server/modules/attendance/queries";
import { shiftForEmployee } from "@/server/modules/attendance/shifts";
import { holidaysForEmployee } from "@/server/modules/holidays/service";
import { balancesFor, leaveYearStartMonth } from "@/server/modules/leave/ledger";
import { getSetting } from "@/server/modules/settings/service";

export interface PeriodOptions {
  today: ISODate;
  now: Date;
  /** Bring the period's attendance up to date first (skipped for arrears and previews). Locked days are never touched. */
  recompute?: boolean;
}

/**
 * Each day of the pay period as payroll sees it (spec §5.6): stored attendance up to today, and from today (while its
 * punches are provisional) a projection where leave, holidays and weekly offs apply and other working days count as
 * worked. Bringing attendance up
 * to date computes the days without a row and today's provisional one; days already computed keep the shift rules they
 * were computed with, as everywhere else in attendance.
 */
export function periodDays(db: DbLike, employeeId: number, period: string, { today, now, recompute = true }: PeriodOptions): PayrollDay[] {
  const { start, end } = monthRange(period);
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!employee) return [];
  const upTo = end < today ? end : today;
  if (recompute && start <= upTo) {
    fillMissingAttendance(db, start, upTo, { now, employeeIds: [employeeId] });
    if (upTo === today) recomputeAttendance(db, employeeId, today, today, { now });
  }

  const shift = shiftForEmployee(db, employeeId);
  const punchMode = shift.attendanceMode === "punch";
  const holidays = new Set(holidaysForEmployee(db, employeeId, start, end).map((h) => h.date));
  const rows = new Map(
    db
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employeeId), gte(attendanceDays.date, start), lte(attendanceDays.date, end)))
      .all()
      .map((r) => [r.date, r]),
  );

  // Approved leave per date, with whether each portion is unpaid.
  const leave = new Map<ISODate, { portion: "full" | "first_half" | "second_half"; lop: boolean }[]>();
  const approved = db
    .select({ request: leaveRequests, isLop: leaveTypes.isLop })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, end), gte(leaveRequests.endDate, start)))
    .all();
  for (const { request: r, isLop } of approved) {
    for (const [date, portion] of requestPortions(r.startDate, r.endDate, r.startHalf, r.endHalf)) {
      leave.set(date, [...(leave.get(date) ?? []), { portion, lop: isLop }]);
    }
  }
  const lopOf = (date: ISODate): 0 | 0.5 | 1 => {
    const portions = leave.get(date) ?? [];
    const days = portions.filter((p) => p.lop).reduce((s, p) => s + (p.portion === "full" ? 1 : 0.5), 0);
    return days >= 1 ? 1 : days >= 0.5 ? 0.5 : 0;
  };

  return eachDay(start, end).map((date): PayrollDay => {
    const working = !holidays.has(date) && !shift.weeklyOffs.includes(dayOfWeek(date));
    const stored = rows.get(date);
    // Today's punch-based status is still changing (an employee who has clocked in reads absent until they clock
    // out), so it's projected like the days after it. An HR override for today is a decision and counts.
    const row = stored && isProvisional(date, today, stored.status) && !stored.overrideStatus ? undefined : stored;
    const lopLeave = lopOf(date);
    if (row) {
      const otherHalfWorked = row.status === "half_leave" && punchMode ? row.workedMinutes >= shift.halfDayMinutes : null;
      return { date, status: row.status, working, lopLeave, otherHalfWorked };
    }
    if (date < employee.dateOfJoining) return { date, status: "not_joined", working, lopLeave: 0, otherHalfWorked: null };
    if (employee.lastWorkingDate && date > employee.lastWorkingDate) return { date, status: "exited", working, lopLeave: 0, otherHalfWorked: null };
    // Not computed yet (after today) or still provisional (today): project it.
    const portions = leave.get(date) ?? [];
    const leaveDays = portions.reduce((s, p) => s + (p.portion === "full" ? 1 : 0.5), 0);
    let status: PayrollDay["status"];
    if (leaveDays >= 1) status = "on_leave";
    else if (holidays.has(date)) status = "holiday";
    else if (!working) status = "weekly_off";
    else if (leaveDays > 0) status = "half_leave";
    else status = "projected";
    return { date, status, working, lopLeave, otherHalfWorked: null };
  });
}

function completedMonths(from: ISODate, to: ISODate): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = to.split("-").map(Number) as [number, number, number];
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
}

/** The formula variables for an employee's pay period, except CTC and MONTHLY_CTC (the calculator sets those). */
export function periodVariables(db: DbLike, employee: EmployeeRow, period: string, opts: PeriodOptions): Record<Exclude<Variable, "CTC" | "MONTHLY_CTC">, number> {
  const { start, end } = monthRange(period);
  const days = summarizeDays(periodDays(db, employee.id, period, opts), getSetting(db, "payroll").prorationBasis);
  const rows = db
    .select({ overtime: attendanceDays.overtimeMinutes, offDay: attendanceDays.offDayWorked })
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employee.id), gte(attendanceDays.date, start), lte(attendanceDays.date, end)))
    .all();
  const compOffDays = db
    .select({ days: compOffClaims.daysRequested, decidedAt: compOffClaims.decidedAt })
    .from(compOffClaims)
    .where(and(eq(compOffClaims.employeeId, employee.id), eq(compOffClaims.status, "approved"), eq(compOffClaims.resolution, "payout"), isNull(compOffClaims.paidRunId)))
    .all()
    .filter((c) => c.decidedAt && c.decidedAt.slice(0, 10) <= end)
    .reduce((s, c) => s + c.days, 0);

  // Leaving this period: encashable leave still available on the last working day is paid out.
  let encashDays = 0;
  if (employee.lastWorkingDate && employee.lastWorkingDate >= start && employee.lastWorkingDate <= end) {
    const year = leaveYearOf(employee.lastWorkingDate, leaveYearStartMonth(db));
    encashDays = balancesFor(db, employee.id, year)
      .filter((b) => b.type.encashable)
      .reduce((s, b) => s + Math.max(0, b.available), 0);
  }
  const serviceEnd = employee.lastWorkingDate && employee.lastWorkingDate < end ? employee.lastWorkingDate : end;
  const months = completedMonths(employee.dateOfJoining, serviceEnd);
  return {
    ...days,
    OT_HOURS: Math.round((rows.reduce((s, r) => s + r.overtime, 0) / 60) * 100) / 100,
    OFF_DAY_WORKED_DAYS: rows.filter((r) => r.offDay).length,
    COMP_OFF_DAYS: compOffDays,
    ENCASH_DAYS: encashDays,
    YEARS_OF_SERVICE: Math.floor(months / 12),
    MONTHS_OF_SERVICE: months,
  };
}
