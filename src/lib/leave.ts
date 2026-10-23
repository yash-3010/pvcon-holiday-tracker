/**
 * Leave and holiday enums, labels and pure leave math shared by the schema, services and UI.
 * Relative imports only: schema files import this and drizzle-kit does not resolve `@/` aliases.
 */
import type { ISODate } from "./dates";

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
