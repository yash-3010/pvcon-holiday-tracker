import type { Permission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { ISODate } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";

/** How a column's values are stored and shown: money in paise, hours in minutes, percent as 0–100. */
export type ColumnType = "text" | "number" | "money" | "date" | "percent" | "minutes" | "days";

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export type ReportRow = Record<string, string | number | null>;

export interface ReportChart {
  type: "bar" | "line";
  /** The column on the x axis. */
  x: string;
  series: { key: string; label: string }[];
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  chart?: ReportChart;
  /** A line under the table, e.g. how a figure is worked out. */
  note?: string;
}

export const FILTER_KINDS = ["period", "range", "date", "year", "week", "department", "employee", "project", "run"] as const;
export type FilterKind = (typeof FILTER_KINDS)[number];

export interface ReportParams {
  period: string;
  from: ISODate;
  to: ISODate;
  date: ISODate;
  year: number;
  /** A Monday. */
  week: ISODate;
  departmentId: number | null;
  employeeId: number | null;
  projectId: number | null;
  runId: number | null;
}

export interface ReportContext {
  user: SessionUser;
  now: Date;
  today: ISODate;
  timeZone: string;
  /** Employees the viewer may see: null for everyone (org-wide permission), else their reporting tree. */
  scope: number[] | null;
}

export type ReportArea = "hr" | "attendance" | "leave" | "timesheets" | "payroll";

export interface ReportDefinition {
  slug: string;
  area: ReportArea;
  title: string;
  description: string;
  /** Any of these runs the report. */
  permissions: Permission[];
  /** Holders see everyone; others see their reporting tree. */
  orgWide: Permission;
  filters: FilterKind[];
  run: (db: DbLike, ctx: ReportContext, params: ReportParams) => ReportResult;
}

export const AREA_LABELS: Record<ReportArea, string> = {
  hr: "People",
  attendance: "Attendance",
  leave: "Leave",
  timesheets: "Timesheets",
  payroll: "Payroll",
};
