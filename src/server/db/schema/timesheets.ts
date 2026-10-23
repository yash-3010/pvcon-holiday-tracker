import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { PROJECT_STATUSES, TIMESHEET_STATUSES } from "../../../lib/timesheets";
import { nowIso, timestamps } from "../columns";
import { users } from "./auth";
import { employees } from "./core";

/** Clients are archived, never deleted, so projects keep pointing at them. */
export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  code: text("code").unique(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** null = an internal project, open to every employee. */
  clientId: integer("client_id").references(() => clients.id),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  billableDefault: integer("billable_default", { mode: "boolean" }).notNull().default(true),
  status: text("status", { enum: PROJECT_STATUSES }).notNull().default("active"),
  startDate: text("start_date"),
  endDate: text("end_date"),
  budgetHours: integer("budget_hours"),
  managerEmployeeId: integer("manager_employee_id").references(() => employees.id, { onDelete: "set null" }),
  ...timestamps(),
});

export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    role: text("role"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.employeeId] }), index("project_members_employee_idx").on(t.employeeId)],
);

export const taskCategories = sqliteTable("task_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  billableDefault: integer("billable_default", { mode: "boolean" }).notNull().default(true),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps(),
});

/** One per employee and week; `week_start` is the Monday. A missing row reads as an empty draft. */
export const timesheets = sqliteTable(
  "timesheets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    weekStart: text("week_start").notNull(),
    status: text("status", { enum: TIMESHEET_STATUSES }).notNull().default("draft"),
    submittedAt: text("submitted_at"),
    approverId: integer("approver_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: text("decided_at"),
    decisionNote: text("decision_note"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("timesheets_employee_week_idx").on(t.employeeId, t.weekStart),
    index("timesheets_status_week_idx").on(t.status, t.weekStart),
  ],
);

/** Minutes in quarter hours. A row of the grid is a (project, category) pair; its billable flag and note sit on each entry. */
export const timesheetEntries = sqliteTable(
  "timesheet_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    timesheetId: integer("timesheet_id")
      .notNull()
      .references(() => timesheets.id, { onDelete: "cascade" }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    taskCategoryId: integer("task_category_id")
      .notNull()
      .references(() => taskCategories.id),
    date: text("date").notNull(),
    minutes: integer("minutes").notNull(),
    billable: integer("billable", { mode: "boolean" }).notNull(),
    notes: text("notes"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("timesheet_entries_cell_idx").on(t.timesheetId, t.projectId, t.taskCategoryId, t.date),
    index("timesheet_entries_project_date_idx").on(t.projectId, t.date),
  ],
);

export const runningTimers = sqliteTable("running_timers", {
  employeeId: integer("employee_id")
    .primaryKey()
    .references(() => employees.id, { onDelete: "cascade" }),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  taskCategoryId: integer("task_category_id")
    .notNull()
    .references(() => taskCategories.id),
  notes: text("notes"),
  /** UTC instant. */
  startedAt: text("started_at").notNull(),
});

export type ClientRow = typeof clients.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type ProjectMemberRow = typeof projectMembers.$inferSelect;
export type TaskCategoryRow = typeof taskCategories.$inferSelect;
export type TimesheetRow = typeof timesheets.$inferSelect;
export type TimesheetEntryRow = typeof timesheetEntries.$inferSelect;
export type RunningTimerRow = typeof runningTimers.$inferSelect;
