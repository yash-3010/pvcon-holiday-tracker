import type { AttendanceStatus } from "@/lib/attendance";
import type { ISODate } from "@/lib/dates";

export type ProrationBasis = "calendar" | "working";

export interface PayrollDay {
  date: ISODate;
  /** The attendance status, or `projected` for a future working day without leave (counted as present). */
  status: AttendanceStatus | "projected";
  /** A working day on the employee's shift (not a weekly off or holiday), whatever their employment. */
  working: boolean;
  /** Loss-of-pay leave on the date: a full day, a half day, or none. */
  lopLeave: 0 | 0.5 | 1;
  /** On a half-day leave: whether the other half was worked. Null where it can't be told (auto-mode shifts). */
  otherHalfWorked: boolean | null;
}

export interface DaySummary {
  TOTAL_DAYS: number;
  WORKING_DAYS: number;
  PAID_DAYS: number;
  LOP_DAYS: number;
  PRESENT_DAYS: number;
}

function lop(day: PayrollDay): number {
  switch (day.status) {
    case "absent":
    case "not_joined":
    case "exited":
      return 1;
    case "half_day":
      return 0.5;
    case "on_leave":
      return day.lopLeave;
    case "half_leave":
      // The leave half, if unpaid, plus the other half when it wasn't worked (refinement 41).
      return day.lopLeave + (day.otherHalfWorked === false ? 0.5 : 0);
    default:
      return 0;
  }
}

function present(day: PayrollDay): number {
  if (day.status === "present" || day.status === "projected") return 1;
  if (day.status === "half_day") return 0.5;
  if (day.status === "half_leave") return day.otherHalfWorked === false ? 0 : 0.5;
  return 0;
}

/**
 * The pay-period day summary (spec §5.6). On the calendar basis every day counts; on the working basis only working
 * days do. Loss of pay: absent 1, half day ½, unpaid leave 1 (½ for a half day), not joined or exited 1.
 */
export function summarizeDays(days: readonly PayrollDay[], basis: ProrationBasis): DaySummary {
  const counted = basis === "calendar" ? days : days.filter((d) => d.working);
  const total = counted.length;
  const lopDays = Math.min(total, counted.reduce((s, d) => s + lop(d), 0));
  return {
    TOTAL_DAYS: total,
    WORKING_DAYS: days.filter((d) => d.working).length,
    PAID_DAYS: Math.max(0, total - lopDays),
    LOP_DAYS: lopDays,
    PRESENT_DAYS: days.reduce((s, d) => s + present(d), 0),
  };
}
