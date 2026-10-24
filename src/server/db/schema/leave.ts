import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { COMP_OFF_CLAIM_STATUSES, COMP_OFF_LOT_STATUSES, COMP_OFF_RESOLUTIONS } from "../../../lib/attendance";
import type { EmploymentType } from "../../../lib/hr";
import { HOLIDAY_TYPES, LEAVE_ACCRUALS, LEAVE_HALVES, LEAVE_REQUEST_STATUSES, LEDGER_KINDS } from "../../../lib/leave";
import { nowIso, timestamps } from "../columns";
import { users } from "./auth";
import { employees } from "./core";
import { files } from "./system";

export const leaveTypes = sqliteTable("leave_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  paid: integer("paid", { mode: "boolean" }).notNull().default(true),
  /** Unpaid leave that payroll counts as loss of pay. */
  isLop: integer("is_lop", { mode: "boolean" }).notNull().default(false),
  accrual: text("accrual", { enum: LEAVE_ACCRUALS }).notNull().default("upfront"),
  /** Days per leave year, in steps of 0.5. */
  annualQuota: real("annual_quota").notNull().default(0),
  carryForwardMax: real("carry_forward_max").notNull().default(0),
  encashable: integer("encashable", { mode: "boolean" }).notNull().default(false),
  allowHalfDay: integer("allow_half_day", { mode: "boolean" }).notNull().default(true),
  allowNegative: integer("allow_negative", { mode: "boolean" }).notNull().default(false),
  maxConsecutiveDays: integer("max_consecutive_days"),
  minNoticeDays: integer("min_notice_days").notNull().default(0),
  /** A supporting document is required when a request is longer than this many days. */
  attachmentAfterDays: real("attachment_after_days"),
  /** Sandwich rule: weekly offs and holidays inside a request count as leave. */
  countWeekends: integer("count_weekends", { mode: "boolean" }).notNull().default(false),
  /** null = every employment type. */
  applicableEmploymentTypes: text("applicable_employment_types", { mode: "json" }).$type<EmploymentType[] | null>(),
  /** The system comp-off type (spec §5.5). Exactly one exists; it cannot be archived. */
  isCompOff: integer("is_comp_off", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

/** Every change to a balance. Balance = SUM(delta) per (employee, leave type, leave year). */
export const leaveLedger = sqliteTable(
  "leave_ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: integer("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    /** Leave year (the calendar year the leave year starts in). */
    year: integer("year").notNull(),
    date: text("date").notNull(),
    /** Days; positive credits, negative debits. */
    delta: real("delta").notNull(),
    kind: text("kind", { enum: LEDGER_KINDS }).notNull(),
    /** What caused the entry, e.g. `leave_request` + its id, `year_end` + the closed year, `legacy`. */
    refType: text("ref_type"),
    refId: integer("ref_id"),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    index("leave_ledger_balance_idx").on(t.employeeId, t.leaveTypeId, t.year),
    index("leave_ledger_ref_idx").on(t.refType, t.refId),
  ],
);

export const leaveRequests = sqliteTable(
  "leave_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    leaveTypeId: integer("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    startHalf: text("start_half", { enum: LEAVE_HALVES }).notNull().default("full"),
    endHalf: text("end_half", { enum: LEAVE_HALVES }).notNull().default("full"),
    /** Counted days at the time of applying; holiday edits never re-price a request. */
    days: real("days").notNull(),
    reason: text("reason"),
    attachmentFileId: integer("attachment_file_id").references(() => files.id, { onDelete: "set null" }),
    status: text("status", { enum: LEAVE_REQUEST_STATUSES }).notNull().default("pending"),
    approverId: integer("approver_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
    /** The login that created the request: the employee, or HR recording it on their behalf. */
    appliedBy: integer("applied_by").references(() => users.id, { onDelete: "set null" }),
    cancelledBy: integer("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: text("cancelled_at"),
    cancelNote: text("cancel_note"),
    ...timestamps(),
  },
  (t) => [
    index("leave_requests_employee_idx").on(t.employeeId, t.status),
    index("leave_requests_status_idx").on(t.status, t.startDate),
  ],
);

export const holidays = sqliteTable(
  "holidays",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Calendar year of `date`; the optional-holiday quota is per calendar year. */
    year: integer("year").notNull(),
    date: text("date").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: HOLIDAY_TYPES }).notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex("holidays_year_date_idx").on(t.year, t.date)],
);

export const holidayYearConfig = sqliteTable("holiday_year_config", {
  year: integer("year").primaryKey(),
  optionalAllowed: integer("optional_allowed").notNull().default(0),
  updatedAt: text("updated_at").notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
});

export const holidaySelections = sqliteTable(
  "holiday_selections",
  {
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    holidayId: integer("holiday_id")
      .notNull()
      .references(() => holidays.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [primaryKey({ columns: [t.employeeId, t.holidayId] })],
);

export const compOffClaims = sqliteTable(
  "comp_off_claims",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    workedDate: text("worked_date").notNull(),
    /** Snapshot of the day's worked minutes when the claim was made. */
    workedMinutes: integer("worked_minutes").notNull(),
    daysRequested: real("days_requested").notNull(),
    reason: text("reason"),
    status: text("status", { enum: COMP_OFF_CLAIM_STATUSES }).notNull().default("pending"),
    approverId: integer("approver_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
    /** How an approved claim was settled: an expiring leave lot, or pay in the next payroll run (Phase 5). */
    resolution: text("resolution", { enum: COMP_OFF_RESOLUTIONS }),
    /** For payout claims: the payroll run that paid them (payroll_runs.id; no foreign key to keep schema modules acyclic). */
    paidRunId: integer("paid_run_id"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    // One live claim per worked day; a rejected or withdrawn claim can be made again.
    uniqueIndex("comp_off_claims_active_idx")
      .on(t.employeeId, t.workedDate)
      .where(sql`${t.status} in ('pending', 'approved')`),
  ],
);

export const compOffLots = sqliteTable(
  "comp_off_lots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** null for a manual grant by HR. */
    claimId: integer("claim_id").references(() => compOffClaims.id, { onDelete: "set null" }),
    days: real("days").notNull(),
    remaining: real("remaining").notNull(),
    earnedOn: text("earned_on").notNull(),
    expiresOn: text("expires_on").notNull(),
    status: text("status", { enum: COMP_OFF_LOT_STATUSES }).notNull().default("active"),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("comp_off_lots_employee_idx").on(t.employeeId, t.status, t.expiresOn)],
);

export const compOffConsumptions = sqliteTable(
  "comp_off_consumptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lotId: integer("lot_id")
      .notNull()
      .references(() => compOffLots.id, { onDelete: "cascade" }),
    leaveRequestId: integer("leave_request_id").notNull(),
    days: real("days").notNull(),
  },
  (t) => [index("comp_off_consumptions_request_idx").on(t.leaveRequestId)],
);

export type LeaveTypeRow = typeof leaveTypes.$inferSelect;
export type CompOffClaimRow = typeof compOffClaims.$inferSelect;
export type CompOffLotRow = typeof compOffLots.$inferSelect;
export type LeaveLedgerRow = typeof leaveLedger.$inferSelect;
export type LeaveRequestRow = typeof leaveRequests.$inferSelect;
export type HolidayRow = typeof holidays.$inferSelect;
export type HolidaySelectionRow = typeof holidaySelections.$inferSelect;
