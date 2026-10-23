import { and, eq, gte, lte } from "drizzle-orm";
import { dayOfWeek, eachDay, parseHm, type ISODate } from "@/lib/dates";
import { requestPortions, type LeaveHalf } from "@/lib/leave";
import { dayAvailableMinutes, type DayKind } from "@/lib/timesheets";
import type { DbLike } from "@/server/db/client";
import { employees, leaveRequests, leaveTypes } from "@/server/db/schema";
import { shiftForEmployee } from "@/server/modules/attendance/shifts";
import { holidaysForEmployee } from "@/server/modules/holidays/service";

export interface WorkDay {
  date: ISODate;
  kind: DayKind;
  holiday: string | null;
  /** Approved leave on the date; two halves read as a full day. */
  leave: { code: string; portion: LeaveHalf } | null;
  availableMinutes: number;
}

/**
 * The employee's calendar for [from, to] (spec §5.3): each day's kind and the hours it offers. A working day offers
 * the shift length less the break. Precedence follows attendance: outside employment, full leave, holiday, weekly off,
 * half-day leave, working.
 */
export function workCalendar(db: DbLike, employeeId: number, from: ISODate, to: ISODate): WorkDay[] {
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!employee || to < from) return [];
  const shift = shiftForEmployee(db, employeeId);
  const shiftMinutes = Math.max(0, parseHm(shift.endTime) - parseHm(shift.startTime) - shift.breakMinutes);
  const holidays = new Map(holidaysForEmployee(db, employeeId, from, to).map((h) => [h.date, h.name]));

  const leave = new Map<ISODate, { code: string; portion: LeaveHalf }>();
  const approved = db
    .select({ request: leaveRequests, code: leaveTypes.code })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        eq(leaveRequests.status, "approved"),
        lte(leaveRequests.startDate, to),
        gte(leaveRequests.endDate, from),
      ),
    )
    .all();
  for (const { request: r, code } of approved) {
    for (const [date, portion] of requestPortions(r.startDate, r.endDate, r.startHalf, r.endHalf)) {
      const earlier = leave.get(date);
      // A morning and an afternoon leave on the same date make a full day.
      leave.set(date, { code, portion: earlier && earlier.portion !== portion ? "full" : portion });
    }
  }

  return eachDay(from, to).map((date): WorkDay => {
    const onLeave = leave.get(date) ?? null;
    const holiday = holidays.get(date) ?? null;
    const employed = date >= employee.dateOfJoining && (!employee.lastWorkingDate || date <= employee.lastWorkingDate);
    let kind: DayKind;
    if (!employed) kind = "not_employed";
    else if (onLeave?.portion === "full") kind = "leave";
    else if (holiday) kind = "holiday";
    else if (shift.weeklyOffs.includes(dayOfWeek(date))) kind = "weekly_off";
    else if (onLeave) kind = "half_leave";
    else kind = "working";
    return { date, kind, holiday, leave: onLeave, availableMinutes: dayAvailableMinutes(kind, shiftMinutes) };
  });
}

export function availableMinutes(db: DbLike, employeeId: number, from: ISODate, to: ISODate): number {
  return workCalendar(db, employeeId, from, to).reduce((sum, d) => sum + d.availableMinutes, 0);
}
