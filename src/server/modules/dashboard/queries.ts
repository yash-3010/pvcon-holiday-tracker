import { and, asc, count, eq, gte, inArray, lte, ne, or } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import { addDays, addMonths, monthRange, type ISODate, type Period } from "@/lib/dates";
import { leaveYearOf } from "@/lib/leave";
import { utilization } from "@/lib/timesheets";
import type { DbLike } from "@/server/db/client";
import {
  compOffClaims, employeeChecklists, employees, expenseClaims, leaveRequests, leaveTypes, payrollRuns, regularizationRequests,
  timesheetEntries, timesheets,
} from "@/server/db/schema";
import { employedDuring } from "@/server/modules/attendance/compute";
import { pendingRegularizationsFor, todayBoard } from "@/server/modules/attendance/queries";
import { myCompOff, pendingCompOffClaimsFor } from "@/server/modules/compoff/queries";
import { eligibleOffDays } from "@/server/modules/compoff/service";
import { getReportingTree, type ScopeUser } from "@/server/modules/employees/scope";
import { holidaysForEmployee } from "@/server/modules/holidays/service";
import { balancesFor, leaveYearStartMonth } from "@/server/modules/leave/ledger";
import { pendingLeaveForApprover } from "@/server/modules/leave/queries";
import { myPayslips, pendingClaimsFor, type MyPayslip } from "@/server/modules/payroll/queries";
import { availableMinutes } from "@/server/modules/timesheets/availability";
import { pendingTimesheetsFor } from "@/server/modules/timesheets/queries";

// ── Employee ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LeaveSnapshot {
  balances: { code: string; name: string; available: number }[];
  compOff: { available: number; nextExpiry: { date: ISODate; days: number } | null };
}

/** Leave available today per type (comp-off from its lots, with the nearest expiry). */
export function leaveSnapshot(db: DbLike, employeeId: number, today: ISODate): LeaveSnapshot {
  const year = leaveYearOf(today, leaveYearStartMonth(db));
  const compOff = myCompOff(db, employeeId, today);
  return {
    balances: balancesFor(db, employeeId, year)
      .filter((b) => !b.type.isCompOff && !b.type.isLop && !b.type.archived)
      .map((b) => ({ code: b.type.code, name: b.type.name, available: b.available })),
    compOff: { available: compOff.available, nextExpiry: compOff.nextExpiry },
  };
}

export function latestPayslip(db: DbLike, employeeId: number): MyPayslip | null {
  return myPayslips(db, employeeId)[0] ?? null;
}

export function upcomingHolidays(db: DbLike, employeeId: number, today: ISODate, limit = 3) {
  return holidaysForEmployee(db, employeeId, today, addDays(today, 180)).slice(0, limit);
}

export interface PendingRequestCounts {
  leave: number;
  regularization: number;
  compOff: number;
  claims: number;
  timesheets: number;
}

/** The employee's own requests still waiting for someone. */
export function myPendingRequests(db: DbLike, employeeId: number): PendingRequestCounts {
  const n = (rows: { n: number }[]) => rows[0]?.n ?? 0;
  return {
    leave: n(db.select({ n: count() }).from(leaveRequests).where(and(eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, "pending"))).all()),
    regularization: n(
      db.select({ n: count() }).from(regularizationRequests).where(and(eq(regularizationRequests.employeeId, employeeId), eq(regularizationRequests.status, "pending"))).all(),
    ),
    compOff: n(db.select({ n: count() }).from(compOffClaims).where(and(eq(compOffClaims.employeeId, employeeId), eq(compOffClaims.status, "pending"))).all()),
    claims: n(db.select({ n: count() }).from(expenseClaims).where(and(eq(expenseClaims.employeeId, employeeId), eq(expenseClaims.status, "submitted"))).all()),
    timesheets: n(db.select({ n: count() }).from(timesheets).where(and(eq(timesheets.employeeId, employeeId), eq(timesheets.status, "submitted"))).all()),
  };
}

/** Off days the employee worked long enough to claim comp-off for. */
export function compOffPrompts(db: DbLike, employeeId: number, today: ISODate): number {
  return eligibleOffDays(db, employeeId, { today }).length;
}

export interface AwayToday {
  employeeId: number;
  name: string;
  leaveType: string;
  half: boolean;
}

/** Approved leave covering `today` for these employees. */
function onLeave(db: DbLike, employeeIds: number[], from: ISODate, to: ISODate) {
  if (!employeeIds.length) return [];
  return db
    .select({ request: leaveRequests, name: employees.displayName, type: leaveTypes.name })
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(inArray(leaveRequests.employeeId, employeeIds), eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from)))
    .orderBy(asc(leaveRequests.startDate), asc(employees.displayName))
    .all();
}

/** Teammates away today: the employee's manager, peers and direct reports on approved leave. */
export function teamOutToday(db: DbLike, employeeId: number, today: ISODate): AwayToday[] {
  const me = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!me) return [];
  const team = db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        ne(employees.id, employeeId),
        inArray(employees.status, ["active", "on_notice"]),
        or(
          eq(employees.reportingManagerId, employeeId),
          me.reportingManagerId !== null ? eq(employees.reportingManagerId, me.reportingManagerId) : undefined,
          me.reportingManagerId !== null ? eq(employees.id, me.reportingManagerId) : undefined,
        ),
      ),
    )
    .all()
    .map((e) => e.id);
  return onLeave(db, team, today, today).map(({ request: r, name, type }) => ({
    employeeId: r.employeeId, name, leaveType: type,
    half: (r.startDate === today && r.startHalf !== "full") || (r.endDate === today && r.endHalf !== "full"),
  }));
}

// ── Manager ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Everything waiting for the user's decision, across the approvals inbox. */
export function pendingApprovalCount(db: DbLike, user: ScopeUser, { today, now }: { today: ISODate; now: Date }): number {
  let n = 0;
  if (can(user, "leave.approve")) n += pendingLeaveForApprover(db, user).length;
  if (can(user, "compoff.approve")) n += pendingCompOffClaimsFor(db, user).length;
  if (can(user, "regularization.approve")) n += pendingRegularizationsFor(db, user).length;
  if (can(user, "timesheet.approve")) n += pendingTimesheetsFor(db, user, { today, now }).length;
  if (can(user, "claim.approve")) n += pendingClaimsFor(db, user).length;
  return n;
}

/** Today's attendance counts for the people the user can see (their tree, or everyone for org-wide viewers). */
export function teamToday(db: DbLike, user: ScopeUser, now: Date) {
  return todayBoard(db, user, now).totals;
}

export interface TeamUtilization {
  people: { employeeId: number; name: string; utilizationPct: number | null; billablePct: number | null }[];
  utilizationPct: number | null;
  billablePct: number | null;
}

/** Logged ÷ available hours in [from, to] for the manager's reporting tree (spec §5.9). */
export function teamUtilization(db: DbLike, managerEmployeeId: number, from: ISODate, to: ISODate): TeamUtilization {
  const ids = getReportingTree(db, managerEmployeeId);
  if (!ids.length) return { people: [], utilizationPct: null, billablePct: null };
  const people = db.select({ id: employees.id, name: employees.displayName }).from(employees).where(and(inArray(employees.id, ids), employedDuring(from, to))).orderBy(asc(employees.displayName)).all();
  const logged = db
    .select({ employeeId: timesheets.employeeId, minutes: timesheetEntries.minutes, billable: timesheetEntries.billable })
    .from(timesheetEntries)
    .innerJoin(timesheets, eq(timesheets.id, timesheetEntries.timesheetId))
    .where(and(inArray(timesheets.employeeId, ids), gte(timesheetEntries.date, from), lte(timesheetEntries.date, to), ne(timesheets.status, "rejected")))
    .all();
  let total = { availableMinutes: 0, loggedMinutes: 0, billableMinutes: 0 };
  const rows = people.map((p) => {
    const mine = logged.filter((l) => l.employeeId === p.id);
    const sums = {
      availableMinutes: availableMinutes(db, p.id, from, to),
      loggedMinutes: mine.reduce((s, l) => s + l.minutes, 0),
      billableMinutes: mine.filter((l) => l.billable).reduce((s, l) => s + l.minutes, 0),
    };
    total = {
      availableMinutes: total.availableMinutes + sums.availableMinutes, loggedMinutes: total.loggedMinutes + sums.loggedMinutes,
      billableMinutes: total.billableMinutes + sums.billableMinutes,
    };
    return { employeeId: p.id, name: p.name, ...utilization(sums) };
  });
  return { people: rows, ...utilization(total) };
}

/** Approved leave of the manager's reporting tree in the next `days` days. */
export function teamLeaveAhead(db: DbLike, managerEmployeeId: number, today: ISODate, days = 7) {
  return onLeave(db, getReportingTree(db, managerEmployeeId), today, addDays(today, days - 1)).map(({ request: r, name, type }) => ({
    employeeId: r.employeeId, name, leaveType: type, startDate: r.startDate, endDate: r.endDate, days: r.days,
  }));
}

// ── HR and admin ────────────────────────────────────────────────────────────────────────────────────────────────

/** Employees on each month's last day (or today for this month), oldest month first. */
export function headcountTrend(db: DbLike, today: ISODate, months = 12): { period: Period; headcount: number }[] {
  const current = today.slice(0, 7);
  return Array.from({ length: months }, (_, i) => addMonths(current, i - months + 1)).map((period) => {
    const end = period === current ? today : monthRange(period).end;
    const n = db.select({ n: count() }).from(employees).where(employedDuring(end, end)).get()?.n ?? 0;
    return { period, headcount: n };
  });
}

export function joinersLeavers(db: DbLike, period: Period) {
  const { start, end } = monthRange(period);
  const pick = { id: employees.id, name: employees.displayName, joined: employees.dateOfJoining, left: employees.lastWorkingDate };
  return {
    joiners: db.select(pick).from(employees).where(and(gte(employees.dateOfJoining, start), lte(employees.dateOfJoining, end))).orderBy(asc(employees.dateOfJoining)).all(),
    leavers: db.select(pick).from(employees).where(and(gte(employees.lastWorkingDate, start), lte(employees.lastWorkingDate, end))).orderBy(asc(employees.lastWorkingDate)).all(),
  };
}

/** People on approved leave today, company-wide. */
export function leavesToday(db: DbLike, today: ISODate): AwayToday[] {
  const everyone = db.select({ id: employees.id }).from(employees).where(employedDuring(today, today)).all().map((e) => e.id);
  return onLeave(db, everyone, today, today).map(({ request: r, name, type }) => ({
    employeeId: r.employeeId, name, leaveType: type,
    half: (r.startDate === today && r.startHalf !== "full") || (r.endDate === today && r.endHalf !== "full"),
  }));
}

/** People serving notice, by last working day, and the count of open onboarding/offboarding checklists. */
export function openExitsAndChecklists(db: DbLike) {
  return {
    exits: db
      .select({ id: employees.id, name: employees.displayName, lastWorkingDate: employees.lastWorkingDate })
      .from(employees)
      .where(eq(employees.status, "on_notice"))
      .orderBy(asc(employees.lastWorkingDate))
      .all(),
    openChecklists: db.select({ n: count() }).from(employeeChecklists).where(eq(employeeChecklists.status, "open")).get()?.n ?? 0,
  };
}

/** The regular runs of last month and this month, if created. */
export function payrollStatus(db: DbLike, today: ISODate) {
  const periods = [addMonths(today.slice(0, 7), -1), today.slice(0, 7)];
  const runs = db
    .select({ id: payrollRuns.id, period: payrollRuns.period, status: payrollRuns.status })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.type, "regular"), ne(payrollRuns.status, "cancelled"), inArray(payrollRuns.period, periods)))
    .all();
  return periods.map((period) => ({ period, run: runs.find((r) => r.period === period) ?? null }));
}

export interface Celebration {
  employeeId: number;
  name: string;
  kind: "birthday" | "anniversary";
  date: ISODate;
  /** Completed years, for work anniversaries. */
  years: number | null;
}

/** Birthdays and work anniversaries of current employees in the next `days` days (29 Feb falls on 28 Feb). */
export function upcomingCelebrations(db: DbLike, today: ISODate, days = 14): Celebration[] {
  const people = db
    .select({ id: employees.id, name: employees.displayName, dob: employees.dateOfBirth, joined: employees.dateOfJoining })
    .from(employees)
    .where(inArray(employees.status, ["active", "on_notice"]))
    .all();
  const end = addDays(today, days - 1);
  const year = Number(today.slice(0, 4));
  const next = (date: string): ISODate | null => {
    for (const y of [year, year + 1]) {
      let candidate = `${y}${date.slice(4)}`;
      if (candidate.endsWith("-02-29") && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) candidate = `${y}-02-28`;
      if (candidate >= today && candidate <= end) return candidate;
    }
    return null;
  };
  const out: Celebration[] = [];
  for (const p of people) {
    const birthday = p.dob ? next(p.dob) : null;
    if (birthday) out.push({ employeeId: p.id, name: p.name, kind: "birthday", date: birthday, years: null });
    const anniversary = next(p.joined);
    if (anniversary && anniversary > p.joined) {
      out.push({ employeeId: p.id, name: p.name, kind: "anniversary", date: anniversary, years: Number(anniversary.slice(0, 4)) - Number(p.joined.slice(0, 4)) });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
