/**
 * Leave and holiday enums, labels and pure leave math shared by the schema, services and UI.
 * Relative imports only: schema files import this and drizzle-kit does not resolve `@/` aliases.
 */
import { addDays, dayOfWeek, eachDay, type ISODate } from "./dates";

export const LEAVE_ACCRUALS = ["upfront", "monthly", "none"] as const;
export type LeaveAccrual = (typeof LEAVE_ACCRUALS)[number];
export const LEAVE_ACCRUAL_LABELS: Record<LeaveAccrual, string> = {
  upfront: "Upfront each leave year",
  monthly: "Monthly",
  none: "No automatic credit",
};

export const LEDGER_KINDS = [
  "grant", "accrual", "carry_forward", "lapse", "taken", "cancelled", "adjustment", "comp_off_credit", "comp_off_lapse",
  "encashment", "opening",
] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];
export const LEDGER_KIND_LABELS: Record<LedgerKind, string> = {
  grant: "Annual grant",
  accrual: "Monthly accrual",
  carry_forward: "Carried forward",
  lapse: "Lapsed",
  taken: "Leave taken",
  cancelled: "Leave cancelled",
  adjustment: "Adjustment",
  comp_off_credit: "Comp-off credit",
  comp_off_lapse: "Comp-off expired",
  encashment: "Encashed",
  opening: "Opening balance",
};

export const LEAVE_REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled", "withdrawn"] as const;
export type LeaveRequestStatus = (typeof LEAVE_REQUEST_STATUSES)[number];
export const LEAVE_STATUS_LABELS: Record<LeaveRequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  withdrawn: "Withdrawn",
};
export const LEAVE_STATUS_BADGE: Record<LeaveRequestStatus, "warning" | "success" | "destructive" | "secondary"> = {
  pending: "warning",
  approved: "success",
  rejected: "destructive",
  cancelled: "secondary",
  withdrawn: "secondary",
};

export const LEAVE_HALVES = ["full", "first_half", "second_half"] as const;
export type LeaveHalf = (typeof LEAVE_HALVES)[number];
export const LEAVE_HALF_LABELS: Record<LeaveHalf, string> = {
  full: "Full day",
  first_half: "First half",
  second_half: "Second half",
};

export const HOLIDAY_TYPES = ["fixed", "optional"] as const;
export type HolidayType = (typeof HOLIDAY_TYPES)[number];
export const HOLIDAY_TYPE_LABELS: Record<HolidayType, string> = { fixed: "Fixed", optional: "Optional" };

export const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** True for multiples of 0.5, the smallest unit of leave. */
export function isHalfStep(n: number): boolean {
  return Number.isFinite(n) && Number.isInteger(n * 2);
}

/** "1 day", "½ day", "2½ days". */
export function formatDays(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const half = abs - whole === 0.5;
  const text = half ? `${whole === 0 ? "" : whole}½` : String(Math.round(abs * 100) / 100);
  return `${sign}${text} ${abs === 1 || abs === 0.5 ? "day" : "days"}`;
}

/**
 * Why a half-day combination is impossible, or null when it is fine.
 * A single day uses one half for both ends; a range may start in the afternoon and end at lunch.
 */
export function halvesError(start: ISODate, end: ISODate, startHalf: LeaveHalf, endHalf: LeaveHalf): string | null {
  if (start === end) return startHalf === endHalf ? null : "A single day uses the same half for start and end";
  if (startHalf === "first_half") return "A leave over several days can only start in the second half";
  if (endHalf === "second_half") return "A leave over several days can only end after the first half";
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Leave years. A leave year is named after the calendar year it starts in; with a January start they coincide.

function parts(date: ISODate): [number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
}

export function leaveYearOf(date: ISODate, startMonth: number): number {
  const [year, month] = parts(date);
  return month >= startMonth ? year : year - 1;
}

export function leaveYearRange(year: number, startMonth: number): { start: ISODate; end: ISODate } {
  const mm = String(startMonth).padStart(2, "0");
  return { start: `${year}-${mm}-01`, end: addDays(`${year + 1}-${mm}-01`, -1) };
}

/** 1 for the leave year's first month … 12 for its last. */
export function leaveYearMonthIndex(date: ISODate, startMonth: number): number {
  const [, month] = parts(date);
  return ((month - startMonth + 12) % 12) + 1;
}

// ---------------------------------------------------------------------------------------------------------------
// Half-day rounding. The epsilon keeps values such as 3.4999999999 (from 7 × 6 / 12) on the right side of a half.

const EPSILON = 1e-9;

/** Nearest multiple of 0.5, ties up. */
export function roundHalf(n: number): number {
  return Math.floor(n * 2 + 0.5 + EPSILON) / 2;
}

/** Largest multiple of 0.5 not above `n`. */
export function floorHalf(n: number): number {
  return Math.floor(n * 2 + EPSILON) / 2;
}

/** Upfront grant for someone who joins in month `joinMonthIndex` (1–12) of the leave year; the joining month counts. */
export function proRatedQuota(annualQuota: number, joinMonthIndex: number): number {
  return roundHalf((annualQuota * (13 - joinMonthIndex)) / 12);
}

/**
 * Monthly accrual for month `monthIndex` (1–12). Credits follow the floored cumulative entitlement, so every credit is a
 * multiple of 0.5 and the twelve credits add up to the annual quota (floored to a half day).
 */
export function accrualCredit(annualQuota: number, monthIndex: number): number {
  return floorHalf((annualQuota * monthIndex) / 12) - floorHalf((annualQuota * (monthIndex - 1)) / 12);
}

// ---------------------------------------------------------------------------------------------------------------
// Day counting (spec §5.4).

export interface LeaveDayInput {
  start: ISODate;
  end: ISODate;
  startHalf: LeaveHalf;
  endHalf: LeaveHalf;
  /** 0 = Sunday … 6 = Saturday. */
  weeklyOffs: readonly number[];
  /** Fixed holidays plus the optional holidays the employee picked. */
  holidays: ReadonlySet<ISODate> | readonly ISODate[];
  /** The type's sandwich rule: weekly offs and holidays inside the range count as leave. */
  countWeekends: boolean;
}

export interface LeaveDay {
  date: ISODate;
  portion: LeaveHalf;
  /** 0, 0.5 or 1. */
  counted: number;
  offReason: "weekly_off" | "holiday" | null;
}

/** Each date of a request with the part of it the request covers. */
export function requestPortions(start: ISODate, end: ISODate, startHalf: LeaveHalf, endHalf: LeaveHalf): Map<ISODate, LeaveHalf> {
  const dates = eachDay(start, end);
  return new Map(
    dates.map((date, i) => {
      if (i === 0) return [date, startHalf];
      if (i === dates.length - 1) return [date, endHalf];
      return [date, "full"];
    }),
  );
}

export function countLeaveDays(input: LeaveDayInput): { days: number; breakdown: LeaveDay[] } {
  if (input.end < input.start) throw new RangeError("The end date is before the start date");
  const error = halvesError(input.start, input.end, input.startHalf, input.endHalf);
  if (error) throw new RangeError(error);
  const holidays = input.holidays instanceof Set ? input.holidays : new Set(input.holidays as readonly ISODate[]);

  const breakdown: LeaveDay[] = [];
  let days = 0;
  for (const [date, portion] of requestPortions(input.start, input.end, input.startHalf, input.endHalf)) {
    const offReason = holidays.has(date) ? "holiday" : input.weeklyOffs.includes(dayOfWeek(date)) ? "weekly_off" : null;
    const counted = offReason && !input.countWeekends ? 0 : portion === "full" ? 1 : 0.5;
    days += counted;
    breakdown.push({ date, portion, counted, offReason });
  }
  return { days, breakdown };
}

/** True when two requests claim the same part of a day. A morning and an afternoon half day may share a date. */
export function portionsOverlap(a: ReadonlyMap<ISODate, LeaveHalf>, b: ReadonlyMap<ISODate, LeaveHalf>): boolean {
  for (const [date, portion] of a) {
    const other = b.get(date);
    if (other && (portion === "full" || other === "full" || portion === other)) return true;
  }
  return false;
}
