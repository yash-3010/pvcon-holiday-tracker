import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import {
  ATTENDANCE_MODES, ATTENDANCE_STATUSES, PUNCH_DIRECTIONS, PUNCH_SOURCES, REGULARIZATION_STATUSES, WORK_MODES,
} from "../../../lib/attendance";
import { nowIso, timestamps } from "../columns";
import { users } from "./auth";
import { employees } from "./core";

/** Times are local `HH:MM` in the company time zone; shifts never cross midnight. */
export const shifts = sqliteTable("shifts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  breakMinutes: integer("break_minutes").notNull().default(60),
  graceMinutes: integer("grace_minutes").notNull().default(15),
  halfDayMinutes: integer("half_day_minutes").notNull().default(240),
  fullDayMinutes: integer("full_day_minutes").notNull().default(480),
  /** 0 = Sunday. */
  weeklyOffs: text("weekly_offs", { mode: "json" }).$type<number[]>().notNull(),
  attendanceMode: text("attendance_mode", { enum: ATTENDANCE_MODES }).notNull().default("punch"),
  /** Open sessions are closed at this local time by the nightly job; null = the shift end. */
  autoClockOutTime: text("auto_clock_out_time"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

export const attendancePunches = sqliteTable(
  "attendance_punches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** UTC instant. */
    at: text("at").notNull(),
    /** Local calendar date of `at` in the company time zone. */
    date: text("date").notNull(),
    direction: text("direction", { enum: PUNCH_DIRECTIONS }).notNull(),
    workMode: text("work_mode", { enum: WORK_MODES }).notNull().default("office"),
    source: text("source", { enum: PUNCH_SOURCES }).notNull().default("web"),
    ip: text("ip"),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("attendance_punches_employee_date_idx").on(t.employeeId, t.date)],
);

/** Computed by `recomputeAttendance`; the only other writers are overrides (on the override columns) and payroll locks. */
export const attendanceDays = sqliteTable(
  "attendance_days",
  {
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    status: text("status", { enum: ATTENDANCE_STATUSES }).notNull(),
    /** Local minutes since midnight. */
    firstIn: integer("first_in"),
    lastOut: integer("last_out"),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    earlyMinutes: integer("early_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    offDayWorked: integer("off_day_worked", { mode: "boolean" }).notNull().default(false),
    leaveRequestId: integer("leave_request_id"),
    /** Set when a payroll run covering the date is approved (Phase 5); locked rows are never recomputed. */
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    computedAt: text("computed_at").notNull().$defaultFn(nowIso),
    overrideStatus: text("override_status", { enum: ATTENDANCE_STATUSES }),
    overrideBy: integer("override_by").references(() => users.id, { onDelete: "set null" }),
    overrideNote: text("override_note"),
    overrideAt: text("override_at"),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.date] }), index("attendance_days_date_idx").on(t.date, t.status)],
);

export const regularizationRequests = sqliteTable(
  "regularization_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    /** Local minutes since midnight. */
    requestedIn: integer("requested_in").notNull(),
    requestedOut: integer("requested_out").notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: REGULARIZATION_STATUSES }).notNull().default("pending"),
    approverId: integer("approver_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
    ...timestamps(),
  },
  (t) => [index("regularization_requests_employee_idx").on(t.employeeId, t.status)],
);

export type ShiftRow = typeof shifts.$inferSelect;
export type AttendancePunchRow = typeof attendancePunches.$inferSelect;
export type AttendanceDayRow = typeof attendanceDays.$inferSelect;
export type RegularizationRequestRow = typeof regularizationRequests.$inferSelect;
