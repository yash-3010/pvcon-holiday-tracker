import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { nowIso } from "../columns";
import { users } from "./auth";

export const companySettings = sqliteTable("company_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedBy: integer("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: text("updated_at").notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
});

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    diff: text("diff", { mode: "json" }).$type<Record<string, unknown> | null>(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    at: text("at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_at_idx").on(t.at),
    index("audit_logs_actor_idx").on(t.actorUserId),
  ],
);

export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: text("read_at"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt)],
);

export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    job: text("job").notNull(),
    runKey: text("run_key").notNull(),
    status: text("status", { enum: ["running", "succeeded", "failed"] }).notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    detail: text("detail"),
  },
  (t) => [uniqueIndex("job_runs_job_key_idx").on(t.job, t.runKey)],
);

export const files = sqliteTable("files", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storageName: text("storage_name").notNull().unique(),
  originalName: text("original_name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  uploadedBy: integer("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().$defaultFn(nowIso),
});

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type JobRunRow = typeof jobRuns.$inferSelect;
export type FileRow = typeof files.$inferSelect;
