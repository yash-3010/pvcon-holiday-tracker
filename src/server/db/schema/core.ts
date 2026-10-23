import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  CHECKLIST_KINDS, DOCUMENT_CATEGORIES, EMPLOYEE_EVENT_TYPES, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, GENDERS,
  MARITAL_STATUSES, PROFILE_CHANGE_STATUSES,
  type Address, type ChecklistItemState, type ChecklistTemplateItem, type EmergencyContact, type EventValues,
} from "../../../lib/hr";
import { nowIso, timestamps } from "../columns";
import { shifts } from "./attendance";
import { users } from "./auth";
import { files } from "./system";

export const departments = sqliteTable("departments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  code: text("code").unique(),
  headEmployeeId: integer("head_employee_id").references((): AnySQLiteColumn => employees.id, { onDelete: "set null" }),
  parentId: integer("parent_id").references((): AnySQLiteColumn => departments.id, { onDelete: "set null" }),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

export const designations = sqliteTable("designations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  level: integer("level"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

export const employees = sqliteTable(
  "employees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .unique()
      .references(() => users.id, { onDelete: "set null" }),
    employeeCode: text("employee_code").notNull().unique(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    displayName: text("display_name").notNull(),
    workEmail: text("work_email").unique(),
    personalEmail: text("personal_email"),
    phone: text("phone"),
    dateOfBirth: text("date_of_birth"),
    gender: text("gender", { enum: GENDERS }),
    maritalStatus: text("marital_status", { enum: MARITAL_STATUSES }),
    address: text("address", { mode: "json" }).$type<Address | null>(),
    emergencyContact: text("emergency_contact", { mode: "json" }).$type<EmergencyContact | null>(),
    departmentId: integer("department_id").references((): AnySQLiteColumn => departments.id),
    designationId: integer("designation_id").references(() => designations.id),
    reportingManagerId: integer("reporting_manager_id").references((): AnySQLiteColumn => employees.id),
    employmentType: text("employment_type", { enum: EMPLOYMENT_TYPES }).notNull().default("full_time"),
    workLocation: text("work_location"),
    dateOfJoining: text("date_of_joining").notNull(),
    probationEndDate: text("probation_end_date"),
    confirmationDate: text("confirmation_date"),
    noticePeriodDays: integer("notice_period_days").notNull().default(30),
    status: text("status", { enum: EMPLOYEE_STATUSES }).notNull().default("active"),
    resignationDate: text("resignation_date"),
    lastWorkingDate: text("last_working_date"),
    exitReason: text("exit_reason"),
    bankName: text("bank_name"),
    /** AES-256-GCM (`encrypt()`); never sent to the client. */
    bankAccountEnc: text("bank_account_enc"),
    bankIfsc: text("bank_ifsc"),
    /** AES-256-GCM of the JSON `IdNumbers`; never sent to the client. */
    idNumbersEnc: text("id_numbers_enc"),
    photoFileId: integer("photo_file_id").references(() => files.id, { onDelete: "set null" }),
    /** null = the default shift (`attendance.defaultShiftId`). Shifts are archived, never deleted. */
    shiftId: integer("shift_id").references((): AnySQLiteColumn => shifts.id),
    ...timestamps(),
  },
  (t) => [
    index("employees_status_idx").on(t.status),
    index("employees_department_idx").on(t.departmentId),
    index("employees_manager_idx").on(t.reportingManagerId),
  ],
);

export const employeeDocuments = sqliteTable(
  "employee_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id),
    category: text("category", { enum: DOCUMENT_CATEGORIES }).notNull(),
    title: text("title").notNull(),
    uploadedBy: integer("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    index("employee_documents_employee_idx").on(t.employeeId),
    uniqueIndex("employee_documents_file_idx").on(t.fileId),
  ],
);

export const employeeEvents = sqliteTable(
  "employee_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    type: text("type", { enum: EMPLOYEE_EVENT_TYPES }).notNull(),
    effectiveDate: text("effective_date").notNull(),
    from: text("from", { mode: "json" }).$type<EventValues | null>(),
    to: text("to", { mode: "json" }).$type<EventValues | null>(),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("employee_events_employee_idx").on(t.employeeId, t.effectiveDate)],
);

export const checklistTemplates = sqliteTable("checklist_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: CHECKLIST_KINDS }).notNull(),
  name: text("name").notNull(),
  items: text("items", { mode: "json" }).$type<ChecklistTemplateItem[]>().notNull(),
  /** The template instantiated automatically for this kind. At most one per kind. */
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

export const employeeChecklists = sqliteTable(
  "employee_checklists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    templateId: integer("template_id").references(() => checklistTemplates.id, { onDelete: "set null" }),
    kind: text("kind", { enum: CHECKLIST_KINDS }).notNull(),
    name: text("name").notNull(),
    items: text("items", { mode: "json" }).$type<ChecklistItemState[]>().notNull(),
    status: text("status", { enum: ["open", "completed", "cancelled"] }).notNull().default("open"),
    ...timestamps(),
  },
  (t) => [index("employee_checklists_employee_idx").on(t.employeeId)],
);

/** Requested bank block; sensitive values are stored encrypted, exactly like the `employees` columns. */
export interface ProfileChangeFields {
  bankName: string | null;
  bankAccountEnc: string | null;
  bankIfsc: string | null;
  idNumbersEnc: string | null;
}

export const profileChangeRequests = sqliteTable(
  "profile_change_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    fields: text("fields", { mode: "json" }).$type<ProfileChangeFields>().notNull(),
    reason: text("reason"),
    status: text("status", { enum: PROFILE_CHANGE_STATUSES }).notNull().default("pending"),
    requestedBy: integer("requested_by").references(() => users.id, { onDelete: "set null" }),
    approverId: integer("approver_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: text("decided_at"),
    note: text("note"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("profile_change_requests_employee_idx").on(t.employeeId, t.status)],
);

export type DepartmentRow = typeof departments.$inferSelect;
export type DesignationRow = typeof designations.$inferSelect;
export type EmployeeRow = typeof employees.$inferSelect;
export type EmployeeDocumentRow = typeof employeeDocuments.$inferSelect;
export type EmployeeEventRow = typeof employeeEvents.$inferSelect;
export type ChecklistTemplateRow = typeof checklistTemplates.$inferSelect;
export type EmployeeChecklistRow = typeof employeeChecklists.$inferSelect;
export type ProfileChangeRequestRow = typeof profileChangeRequests.$inferSelect;
