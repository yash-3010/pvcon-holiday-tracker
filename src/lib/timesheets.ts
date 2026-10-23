import { addDays, dayOfWeek, isISODate, type ISODate } from "./dates";

export const TIMESHEET_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];
export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};
export const TIMESHEET_STATUS_BADGE: Record<TimesheetStatus, "secondary" | "warning" | "success" | "destructive"> = {
  draft: "secondary",
  submitted: "warning",
  approved: "success",
  rejected: "destructive",
};
/** Only these weeks accept changes; submitting locks a week and a rejection unlocks it. */
export const EDITABLE_STATUSES: readonly TimesheetStatus[] = ["draft", "rejected"];

export const PROJECT_STATUSES = ["active", "on_hold", "closed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = { active: "Active", on_hold: "On hold", closed: "Closed" };
export const PROJECT_STATUS_BADGE: Record<ProjectStatus, "success" | "warning" | "secondary"> = {
  active: "success",
  on_hold: "warning",
  closed: "secondary",
};

// ---------------------------------------------------------------------------------------------------------------
// Durations are integer minutes on a quarter-hour grid; the timesheet shows them as hours in 0.25 steps.

export const QUARTER = 15;
export const DAY_MINUTES = 1440;

export function isQuarterHour(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes % QUARTER === 0;
}

/** Hours typed in the grid → minutes, rounded to the nearest quarter hour. */
export function hoursToMinutes(hours: number): number {
  return Math.round((hours * 60) / QUARTER) * QUARTER;
}

export function minutesToHours(minutes: number): number {
  return minutes / 60;
}

/** `480 → "8"`, `450 → "7.5"`, `75 → "1.25"`. */
export function formatHours(minutes: number): string {
  return String(Math.round((minutes / 60) * 100) / 100);
}

/** A stopped timer adds its time rounded to the nearest quarter hour; under 8 minutes adds nothing. */
export function roundTimerMinutes(elapsedMinutes: number): number {
  return Math.round(elapsedMinutes / QUARTER) * QUARTER;
}

// ---------------------------------------------------------------------------------------------------------------
// Weeks run Monday to Sunday and are named by their Monday.

export function isWeekStart(date: string): boolean {
  return isISODate(date) && dayOfWeek(date) === 1;
}

export function weekDates(weekStart: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

// ---------------------------------------------------------------------------------------------------------------
// Availability and utilization (spec §5.3): available hours come from the attendance calendar.

export type DayKind = "working" | "half_leave" | "leave" | "holiday" | "weekly_off" | "not_employed";

/** A working day offers the shift's hours, a half-day leave half of them (rounded down to a quarter), others none. */
export function dayAvailableMinutes(kind: DayKind, shiftMinutes: number): number {
  if (kind === "working") return shiftMinutes;
  if (kind === "half_leave") return Math.floor(shiftMinutes / 2 / QUARTER) * QUARTER;
  return 0;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** Utilization = logged ÷ available; billable share = billable ÷ logged. One decimal; null without a base. */
export function utilization({ availableMinutes, loggedMinutes, billableMinutes }: { availableMinutes: number; loggedMinutes: number; billableMinutes: number }): {
  utilizationPct: number | null;
  billablePct: number | null;
} {
  return { utilizationPct: pct(loggedMinutes, availableMinutes), billablePct: pct(billableMinutes, loggedMinutes) };
}
