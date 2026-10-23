/**
 * Attendance and comp-off enums, labels and pure attendance math shared by the schema, services and UI.
 * Relative imports only: schema files import this and drizzle-kit does not resolve `@/` aliases.
 */

export const ATTENDANCE_STATUSES = [
  "present", "half_day", "absent", "on_leave", "half_leave", "holiday", "weekly_off", "not_joined", "exited",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Present",
  half_day: "Half day",
  absent: "Absent",
  on_leave: "On leave",
  half_leave: "Half-day leave",
  holiday: "Holiday",
  weekly_off: "Weekly off",
  not_joined: "Not joined",
  exited: "Exited",
};
/** Muster-roll codes (spec §5.2). */
export const ATTENDANCE_CODES: Record<AttendanceStatus, string> = {
  present: "P",
  half_day: "HD",
  absent: "A",
  on_leave: "L",
  half_leave: "HL",
  holiday: "H",
  weekly_off: "WO",
  not_joined: "NJ",
  exited: "EX",
};
export const ATTENDANCE_STATUS_BADGE: Record<AttendanceStatus, "success" | "warning" | "destructive" | "info" | "secondary" | "default"> = {
  present: "success",
  half_day: "warning",
  absent: "destructive",
  on_leave: "info",
  half_leave: "info",
  holiday: "default",
  weekly_off: "secondary",
  not_joined: "secondary",
  exited: "secondary",
};

export const PUNCH_DIRECTIONS = ["in", "out"] as const;
export type PunchDirection = (typeof PUNCH_DIRECTIONS)[number];
export const WORK_MODES = ["office", "remote"] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export const WORK_MODE_LABELS: Record<WorkMode, string> = { office: "Office", remote: "Remote" };
export const PUNCH_SOURCES = ["web", "admin", "regularization", "auto"] as const;
export type PunchSource = (typeof PUNCH_SOURCES)[number];
export const ATTENDANCE_MODES = ["punch", "auto"] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];
export const ATTENDANCE_MODE_LABELS: Record<AttendanceMode, string> = {
  punch: "Clock in and out",
  auto: "Present unless on leave",
};

export const REGULARIZATION_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type RegularizationStatus = (typeof REGULARIZATION_STATUSES)[number];

export const COMP_OFF_CLAIM_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type CompOffClaimStatus = (typeof COMP_OFF_CLAIM_STATUSES)[number];
export const COMP_OFF_RESOLUTIONS = ["leave", "payout"] as const;
export type CompOffResolution = (typeof COMP_OFF_RESOLUTIONS)[number];
export const COMP_OFF_LOT_STATUSES = ["active", "consumed", "expired", "paid_out"] as const;
export type CompOffLotStatus = (typeof COMP_OFF_LOT_STATUSES)[number];
export const COMP_OFF_LOT_STATUS_LABELS: Record<CompOffLotStatus, string> = {
  active: "Active",
  consumed: "Used",
  expired: "Expired",
  paid_out: "Paid out",
};
