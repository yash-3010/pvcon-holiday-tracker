import type { SessionUser } from "@/lib/auth/types";
import { todayInTimeZone } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { getSetting } from "@/server/modules/settings/service";
import { attendanceReports } from "./attendance";
import { hrReports } from "./hr";
import { leaveReports } from "./leave";
import { payrollReports } from "./payroll";
import { canRunReport, parseReportParams, reportScope } from "./scope";
import { timesheetsReports } from "./timesheets";
import type { ReportContext, ReportDefinition, ReportParams, ReportResult } from "./types";

/** Every report of spec §5.10, by area. */
export const REPORTS: ReportDefinition[] = [...hrReports, ...attendanceReports, ...leaveReports, ...timesheetsReports, ...payrollReports];

export function findReport(slug: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.slug === slug);
}

export function reportsFor(user: SessionUser): ReportDefinition[] {
  return REPORTS.filter((r) => canRunReport(user, r));
}

/** Runs a report for a viewer with query-string parameters, applying their permission and scope. */
export function runReport(
  db: DbLike,
  user: SessionUser,
  slug: string,
  raw: Record<string, string | undefined>,
  now: Date = new Date(),
  { forExport = false }: { forExport?: boolean } = {},
): { report: ReportDefinition; params: ReportParams; result: ReportResult; ctx: ReportContext } {
  const report = findReport(slug);
  if (!report) throw new DomainError("NOT_FOUND", "Report not found.");
  if (!canRunReport(user, report)) throw new DomainError("FORBIDDEN", "You can't run this report.");
  const timeZone = getSetting(db, "locale").timezone;
  const today = todayInTimeZone(timeZone, now);
  const scope = reportScope(db, user, report);
  const ctx: ReportContext = { user, now, today, timeZone, scope, forExport };
  const params = parseReportParams(db, raw, { today, scope });
  return { report, params, result: report.run(db, ctx, params), ctx };
}
