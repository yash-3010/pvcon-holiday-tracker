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

// ---------------------------------------------------------------------------------------------------------------
// Daily computation (spec §5.2). Times are local minutes since midnight in the company time zone.

export interface PunchAt {
  minutes: number;
  direction: PunchDirection;
}

export interface Session {
  inMinutes: number;
  /** null while still clocked in. */
  outMinutes: number | null;
}

/** In→out pairs in time order. A second `in` while one is open and an `out` with nothing open are ignored. */
export function pairPunches(punches: readonly PunchAt[]): Session[] {
  const sessions: Session[] = [];
  let open: Session | null = null;
  for (const p of [...punches].sort((a, b) => a.minutes - b.minutes)) {
    if (p.direction === "in" && !open) {
      open = { inMinutes: p.minutes, outMinutes: null };
      sessions.push(open);
    } else if (p.direction === "out" && open) {
      open.outMinutes = p.minutes;
      open = null;
    }
  }
  return sessions;
}

export interface ShiftRules {
  startMinutes: number;
  endMinutes: number;
  graceMinutes: number;
  halfDayMinutes: number;
  fullDayMinutes: number;
  weeklyOffs: readonly number[];
  mode: AttendanceMode;
}

export interface AttendanceDayInput {
  date: string;
  /** 0 = Sunday. */
  weekday: number;
  dateOfJoining: string;
  lastWorkingDate: string | null;
  shift: ShiftRules;
  /** Name of a fixed holiday or a picked optional one. */
  holiday: string | null;
  /** Approved leave touching the date. */
  leave: readonly { portion: "full" | "first_half" | "second_half"; requestId: number }[];
  sessions: readonly Session[];
  /** For today: an open session counts up to now. */
  nowMinutes: number | null;
  override: AttendanceStatus | null;
}

export interface AttendanceDayResult {
  status: AttendanceStatus;
  firstIn: number | null;
  lastOut: number | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  overtimeMinutes: number;
  offDayWorked: boolean;
  leaveRequestId: number | null;
}

export function computeAttendanceDay(input: AttendanceDayInput): AttendanceDayResult {
  const { shift, sessions } = input;
  const workedMinutes = sessions.reduce((sum, s) => {
    const end = s.outMinutes ?? input.nowMinutes;
    return end === null ? sum : sum + Math.max(0, end - s.inMinutes);
  }, 0);
  const firstIn = sessions.length ? Math.min(...sessions.map((s) => s.inMinutes)) : null;
  const last = sessions.at(-1);
  const lastOut = last && last.outMinutes !== null ? last.outMinutes : null;

  const portions = new Set(input.leave.map((l) => l.portion));
  const fullLeave = portions.has("full") || (portions.has("first_half") && portions.has("second_half"));
  const leaveRequestId = input.leave[0]?.requestId ?? null;
  const offDay = input.holiday !== null || shift.weeklyOffs.includes(input.weekday);
  const workingDay = !offDay && !fullLeave;

  let status: AttendanceStatus;
  if (input.date < input.dateOfJoining) status = "not_joined";
  else if (input.lastWorkingDate !== null && input.date > input.lastWorkingDate) status = "exited";
  else if (input.override) status = input.override;
  else if (fullLeave) status = "on_leave";
  else if (input.holiday !== null) status = "holiday";
  else if (shift.weeklyOffs.includes(input.weekday)) status = "weekly_off";
  else if (portions.size > 0) status = "half_leave";
  else if (shift.mode === "auto") status = "present";
  else if (workedMinutes >= shift.fullDayMinutes) status = "present";
  else if (workedMinutes >= shift.halfDayMinutes) status = "half_day";
  else status = "absent";

  return {
    status,
    firstIn,
    lastOut,
    workedMinutes,
    // A morning half-day leave means arriving after lunch is not late; an afternoon one, leaving at lunch is not early.
    lateMinutes:
      workingDay && firstIn !== null && !portions.has("first_half") ? Math.max(0, firstIn - (shift.startMinutes + shift.graceMinutes)) : 0,
    earlyMinutes: workingDay && lastOut !== null && !portions.has("second_half") ? Math.max(0, shift.endMinutes - lastOut) : 0,
    overtimeMinutes: offDay ? workedMinutes : workingDay ? Math.max(0, workedMinutes - shift.fullDayMinutes) : 0,
    offDayWorked: offDay && workedMinutes > 0,
    leaveRequestId,
  };
}

/** Comp-off days earned by off-day work (spec §5.5): a full day, a half day, or nothing. */
export function compOffDaysFor(workedMinutes: number, thresholds: { half: number; full: number }): 0 | 0.5 | 1 {
  if (workedMinutes >= thresholds.full) return 1;
  if (workedMinutes >= thresholds.half) return 0.5;
  return 0;
}
