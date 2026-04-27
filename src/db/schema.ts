import { sqliteTable, text, integer, real, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "employee"] }).notNull().default("employee"),
  joinedDate: text("joined_date").notNull(),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const holidays = sqliteTable(
  "holidays",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    year: integer("year").notNull(),
    date: text("date").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ["fixed", "optional"] }).notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [uniqueIndex("holidays_year_date_idx").on(t.year, t.date)]
);

export const holidaySelections = sqliteTable(
  "holiday_selections",
  {
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    holidayId: integer("holiday_id").notNull().references(() => holidays.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.holidayId] })]
);

export const leaves = sqliteTable("leaves", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  days: real("days").notNull(),
  type: text("type", { enum: ["casual", "sick", "unpaid"] }).notNull(),
  reason: text("reason"),
  status: text("status", { enum: ["planned", "taken", "cancelled"] }).notNull().default("planned"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const leavePolicy = sqliteTable("leave_policy", {
  year: integer("year").primaryKey(),
  casualPerYear: integer("casual_per_year").notNull().default(12),
  sickPerYear: integer("sick_per_year").notNull().default(6),
  carryFwdMax: integer("carry_fwd_max").notNull().default(6),
  maxConsecutiveDays: integer("max_consecutive_days").notNull().default(3),
  optionalHolidaysAllowed: integer("optional_holidays_allowed").notNull().default(6),
});

export const userYearBalance = sqliteTable(
  "user_year_balance",
  {
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    carryForwardCl: real("carry_forward_cl").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.year] })]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Holiday = typeof holidays.$inferSelect;
export type Leave = typeof leaves.$inferSelect;
