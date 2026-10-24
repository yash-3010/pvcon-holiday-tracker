import { can, canAny } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { addDays, addMonths, fiscalYearOf, isISODate, isPeriod, startOfWeek, type ISODate } from "@/lib/dates";
import { leaveYearOf } from "@/lib/leave";
import type { DbLike } from "@/server/db/client";
import { getReportingTree } from "@/server/modules/employees/scope";
import { leaveYearStartMonth } from "@/server/modules/leave/ledger";
import { getSetting } from "@/server/modules/settings/service";
import type { ReportDefinition, ReportParams } from "./types";

export function canRunReport(user: SessionUser, report: ReportDefinition): boolean {
  return canAny(user, report.permissions);
}

/** Null for org-wide viewers (everyone); else the viewer's reporting tree. */
export function reportScope(db: DbLike, user: SessionUser, report: ReportDefinition): number[] | null {
  if (can(user, report.orgWide)) return null;
  return user.employeeId === null ? [] : getReportingTree(db, user.employeeId);
}

const positiveInt = (value: string | undefined) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Report parameters from query-string values, falling back to defaults: last month for periods, this month to
 * today for ranges, today for dates, the current leave year, the financial year of last month, last week.
 * Out-of-scope employees are dropped.
 */
export function parseReportParams(
  db: DbLike,
  raw: Record<string, string | undefined>,
  { today, scope }: { today: ISODate; scope: number[] | null },
): ReportParams {
  const thisMonth = today.slice(0, 7);
  let from = raw.from && isISODate(raw.from) ? raw.from : `${thisMonth}-01`;
  let to = raw.to && isISODate(raw.to) ? raw.to : today;
  if (from > to) [from, to] = [to, from];
  const year = Number(raw.year);
  const employeeId = positiveInt(raw.employee);
  const lastMonth = addMonths(thisMonth, -1);
  const fyStartMonth = getSetting(db, "locale").fiscalYearStartMonth;
  const fyYear = Number(raw.fy);
  const fiscalYear = fiscalYearOf(
    Number.isInteger(fyYear) && fyYear > 2000 && fyYear < 2100 ? `${fyYear}-${String(fyStartMonth).padStart(2, "0")}` : lastMonth,
    fyStartMonth,
  );
  return {
    period: raw.period && isPeriod(raw.period) ? raw.period : lastMonth,
    from,
    to,
    date: raw.date && isISODate(raw.date) ? raw.date : today,
    year: Number.isInteger(year) && year > 2000 && year < 2100 ? year : leaveYearOf(today, leaveYearStartMonth(db)),
    fiscalYear,
    week: raw.week && isISODate(raw.week) ? startOfWeek(raw.week) : addDays(startOfWeek(today), -7),
    departmentId: positiveInt(raw.department),
    employeeId: employeeId !== null && (scope === null || scope.includes(employeeId)) ? employeeId : null,
    projectId: positiveInt(raw.project),
    runId: positiveInt(raw.run),
  };
}
