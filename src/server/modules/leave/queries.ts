import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { can } from "@/lib/auth/permissions";
import { dayOfWeek, eachDay, monthRange, type ISODate, type Period } from "@/lib/dates";
import { leaveYearOf, leaveYearRange, requestPortions, type LeaveHalf, type LeaveRequestStatus, type LedgerKind } from "@/lib/leave";
import type { DbLike } from "@/server/db/client";
import {
  departments, employees, holidaySelections, holidays, leaveLedger, leaveRequests, leaveTypes, users,
} from "@/server/db/schema";
import { weeklyOffsForEmployee } from "@/server/modules/attendance/calendar";
import { getReportingTree, type ScopeUser } from "@/server/modules/employees/scope";
import { balanceOf, balancesFor, leaveYearStartMonth, type LeaveBalance } from "./ledger";
import { listLeaveTypes } from "./types";

export interface LeaveTypeTag {
  id: number;
  code: string;
  name: string;
  color: string;
}

export interface LeaveRequestView {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeCode: string;
  leaveType: LeaveTypeTag;
  startDate: ISODate;
  endDate: ISODate;
  startHalf: LeaveHalf;
  endHalf: LeaveHalf;
  days: number;
  reason: string | null;
  status: LeaveRequestStatus;
  attachmentFileId: number | null;
  approverName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  cancelNote: string | null;
  createdAt: string;
}

const approver = alias(users, "approver");
const CURRENT = inArray(employees.status, ["active", "on_notice"]);

function requestViews(db: DbLike, where: SQL | undefined, orderBy: SQL[], limit = 1000): LeaveRequestView[] {
  return db
    .select({
      id: leaveRequests.id,
      employeeId: leaveRequests.employeeId,
      employeeName: employees.displayName,
      employeeCode: employees.employeeCode,
      typeId: leaveTypes.id,
      typeCode: leaveTypes.code,
      typeName: leaveTypes.name,
      typeColor: leaveTypes.color,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      startHalf: leaveRequests.startHalf,
      endHalf: leaveRequests.endHalf,
      days: leaveRequests.days,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      attachmentFileId: leaveRequests.attachmentFileId,
      approverName: approver.name,
      decidedAt: leaveRequests.decidedAt,
      decisionNote: leaveRequests.decisionNote,
      cancelNote: leaveRequests.cancelNote,
      createdAt: leaveRequests.createdAt,
    })
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .leftJoin(approver, eq(approver.id, leaveRequests.approverId))
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)
    .all()
    .map(({ typeId, typeCode, typeName, typeColor, ...row }) => ({
      ...row,
      leaveType: { id: typeId, code: typeCode, name: typeName, color: typeColor },
    }));
}

/** Requests that start in the leave year, newest first, with what the employee can still do with each. */
export function myLeaveRequests(
  db: DbLike,
  employeeId: number,
  year: number,
  today: ISODate,
): (LeaveRequestView & { canWithdraw: boolean; canCancel: boolean })[] {
  const range = leaveYearRange(year, leaveYearStartMonth(db));
  return requestViews(
    db,
    and(eq(leaveRequests.employeeId, employeeId), gte(leaveRequests.startDate, range.start), lte(leaveRequests.startDate, range.end)),
    [desc(leaveRequests.startDate), desc(leaveRequests.id)],
  ).map((r) => ({ ...r, canWithdraw: r.status === "pending", canCancel: r.status === "approved" && r.startDate > today }));
}

/** Employee ids whose requests `user` may see as an approver: "all", their reporting tree, or none. */
function approverScope(db: DbLike, user: ScopeUser): "all" | number[] {
  if (can(user, "leave.view.all")) return "all";
  if (!can(user, "leave.approve") || user.employeeId === null) return [];
  return getReportingTree(db, user.employeeId);
}

/** Pending requests `user` can decide (`canDecideLeave`), oldest first, with the balance before and after. */
export function pendingLeaveForApprover(
  db: DbLike,
  user: ScopeUser,
): (LeaveRequestView & { balance: number; balanceAfter: number })[] {
  if (!can(user, "leave.approve")) return [];
  const scope = approverScope(db, user);
  if (scope !== "all" && scope.length === 0) return [];
  const startMonth = leaveYearStartMonth(db);
  return requestViews(
    db,
    and(
      eq(leaveRequests.status, "pending"),
      user.employeeId === null ? undefined : ne(leaveRequests.employeeId, user.employeeId),
      scope === "all" ? undefined : inArray(leaveRequests.employeeId, scope),
    ),
    [asc(leaveRequests.createdAt), asc(leaveRequests.id)],
  ).map((r) => {
    const balance = balanceOf(db, r.employeeId, r.leaveType.id, leaveYearOf(r.startDate, startMonth));
    return { ...r, balance, balanceAfter: balance - r.days };
  });
}

export interface LeaveRequestFilters {
  status?: LeaveRequestStatus;
  leaveTypeId?: number;
  employeeId?: number;
  /** Requests overlapping [from, to]. */
  from?: ISODate;
  to?: ISODate;
}

/** The request register: everyone for `leave.view.all`, the reporting tree for other approvers. */
export function listLeaveRequests(db: DbLike, user: ScopeUser, filters: LeaveRequestFilters): LeaveRequestView[] {
  const scope = approverScope(db, user);
  if (scope !== "all" && scope.length === 0) return [];
  return requestViews(
    db,
    and(
      scope === "all" ? undefined : inArray(leaveRequests.employeeId, scope),
      filters.status ? eq(leaveRequests.status, filters.status) : undefined,
      filters.leaveTypeId ? eq(leaveRequests.leaveTypeId, filters.leaveTypeId) : undefined,
      filters.employeeId ? eq(leaveRequests.employeeId, filters.employeeId) : undefined,
      filters.to ? lte(leaveRequests.startDate, filters.to) : undefined,
      filters.from ? gte(leaveRequests.endDate, filters.from) : undefined,
    ),
    [desc(leaveRequests.startDate), desc(leaveRequests.id)],
  );
}

export interface BalanceSheet {
  types: LeaveTypeTag[];
  rows: {
    employee: { id: number; name: string; code: string; department: string | null };
    balances: Record<number, { balance: number; used: number; pending: number }>;
  }[];
}

const USED_KINDS: LedgerKind[] = ["taken", "cancelled"];

/** Current employees × current leave types for one leave year. */
export function balanceSheet(db: DbLike, year: number, { departmentId }: { departmentId?: number }): BalanceSheet {
  const types = listLeaveTypes(db).map(({ id, code, name, color }) => ({ id, code, name, color }));
  const people = db
    .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode, department: departments.name })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(CURRENT, departmentId ? eq(employees.departmentId, departmentId) : undefined))
    .orderBy(asc(employees.id))
    .all();
  const ids = people.map((p) => p.id);
  if (ids.length === 0) return { types, rows: [] };

  const sums = db
    .select({
      employeeId: leaveLedger.employeeId,
      leaveTypeId: leaveLedger.leaveTypeId,
      balance: sql<number>`sum(${leaveLedger.delta})`,
      used: sql<number>`-sum(case when ${inArray(leaveLedger.kind, USED_KINDS)} then ${leaveLedger.delta} else 0 end)`,
    })
    .from(leaveLedger)
    .where(and(eq(leaveLedger.year, year), inArray(leaveLedger.employeeId, ids)))
    .groupBy(leaveLedger.employeeId, leaveLedger.leaveTypeId)
    .all();
  const range = leaveYearRange(year, leaveYearStartMonth(db));
  const pending = db
    .select({ employeeId: leaveRequests.employeeId, leaveTypeId: leaveRequests.leaveTypeId, days: sql<number>`sum(${leaveRequests.days})` })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.status, "pending"),
        inArray(leaveRequests.employeeId, ids),
        gte(leaveRequests.startDate, range.start),
        lte(leaveRequests.startDate, range.end),
      ),
    )
    .groupBy(leaveRequests.employeeId, leaveRequests.leaveTypeId)
    .all();

  return {
    types,
    rows: people.map((employee) => ({
      employee,
      balances: Object.fromEntries(
        types.map((t) => {
          const sum = sums.find((s) => s.employeeId === employee.id && s.leaveTypeId === t.id);
          const open = pending.find((p) => p.employeeId === employee.id && p.leaveTypeId === t.id);
          return [t.id, { balance: sum?.balance ?? 0, used: sum?.used || 0, pending: open?.days ?? 0 }];
        }),
      ),
    })),
  };
}

export interface LedgerEntryView {
  id: number;
  date: ISODate;
  kind: LedgerKind;
  delta: number;
  note: string | null;
  refType: string | null;
  refId: number | null;
  createdByName: string | null;
  createdAt: string;
}

export function employeeLedger(db: DbLike, employeeId: number, leaveTypeId: number, year: number): LedgerEntryView[] {
  return db
    .select({
      id: leaveLedger.id,
      date: leaveLedger.date,
      kind: leaveLedger.kind,
      delta: leaveLedger.delta,
      note: leaveLedger.note,
      refType: leaveLedger.refType,
      refId: leaveLedger.refId,
      createdByName: users.name,
      createdAt: leaveLedger.createdAt,
    })
    .from(leaveLedger)
    .leftJoin(users, eq(users.id, leaveLedger.createdBy))
    .where(and(eq(leaveLedger.employeeId, employeeId), eq(leaveLedger.leaveTypeId, leaveTypeId), eq(leaveLedger.year, year)))
    .orderBy(asc(leaveLedger.id))
    .all();
}

export type CalendarCell =
  | { kind: "leave"; code: string; name: string; color: string | null; portion: LeaveHalf; status: "pending" | "approved" }
  | { kind: "holiday"; name: string };

export interface TeamCalendar {
  month: Period;
  days: { date: ISODate; weekday: number; holiday: string | null }[];
  rows: {
    employee: { id: number; name: string; code: string };
    weeklyOffs: number[];
    cells: Record<ISODate, CalendarCell>;
  }[];
}

/**
 * Month view of leave (pending and approved) and holidays. Org-wide viewers see everyone (optionally one department);
 * everyone else sees themselves, their reporting tree and their peers. The leave type is shown only to the employee,
 * org-wide viewers and managers above them; others see "Leave".
 */
export function teamCalendar(db: DbLike, user: ScopeUser, month: Period, { departmentId }: { departmentId?: number }): TeamCalendar {
  const { start, end } = monthRange(month);
  const orgWide = can(user, "leave.view.all");
  const below = new Set(user.employeeId === null ? [] : getReportingTree(db, user.employeeId));

  let memberWhere: SQL | undefined;
  if (orgWide) {
    memberWhere = departmentId ? eq(employees.departmentId, departmentId) : undefined;
  } else if (user.employeeId !== null) {
    const self = db.select({ managerId: employees.reportingManagerId }).from(employees).where(eq(employees.id, user.employeeId)).get();
    memberWhere = or(
      inArray(employees.id, [user.employeeId, ...below]),
      self?.managerId ? eq(employees.reportingManagerId, self.managerId) : undefined,
    );
  }
  const members =
    orgWide || user.employeeId !== null
      ? db
          .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode })
          .from(employees)
          .where(and(CURRENT, memberWhere))
          .orderBy(asc(employees.id))
          .all()
      : [];

  const fixed = new Map(
    db
      .select({ date: holidays.date, name: holidays.name })
      .from(holidays)
      .where(and(eq(holidays.type, "fixed"), gte(holidays.date, start), lte(holidays.date, end)))
      .all()
      .map((h) => [h.date, h.name]),
  );
  const days = eachDay(start, end).map((date) => ({ date, weekday: dayOfWeek(date), holiday: fixed.get(date) ?? null }));
  const ids = members.map((m) => m.id);
  const rows: TeamCalendar["rows"] = members.map((employee) => ({
    employee,
    weeklyOffs: weeklyOffsForEmployee(db, employee.id),
    cells: {},
  }));
  if (ids.length === 0) return { month, days, rows };
  const rowFor = new Map(rows.map((r) => [r.employee.id, r]));

  const picks = db
    .select({ employeeId: holidaySelections.employeeId, date: holidays.date, name: holidays.name })
    .from(holidaySelections)
    .innerJoin(holidays, eq(holidays.id, holidaySelections.holidayId))
    .where(and(inArray(holidaySelections.employeeId, ids), eq(holidays.type, "optional"), gte(holidays.date, start), lte(holidays.date, end)))
    .all();
  for (const pick of picks) rowFor.get(pick.employeeId)!.cells[pick.date] = { kind: "holiday", name: pick.name };

  const requests = requestViews(
    db,
    and(
      inArray(leaveRequests.employeeId, ids),
      inArray(leaveRequests.status, ["pending", "approved"]),
      lte(leaveRequests.startDate, end),
      gte(leaveRequests.endDate, start),
    ),
    [asc(leaveRequests.startDate)],
  );
  for (const r of requests) {
    const showType = orgWide || r.employeeId === user.employeeId || below.has(r.employeeId);
    const status = r.status as "pending" | "approved";
    for (const [date, portion] of requestPortions(r.startDate, r.endDate, r.startHalf, r.endHalf)) {
      if (date < start || date > end) continue;
      rowFor.get(r.employeeId)!.cells[date] = showType
        ? { kind: "leave", code: r.leaveType.code, name: r.leaveType.name, color: r.leaveType.color, portion, status }
        : { kind: "leave", code: "Leave", name: "Leave", color: null, portion, status };
    }
  }
  return { month, days, rows };
}

/** The profile Leave tab: balances for the year and the ten latest requests. */
export function employeeLeaveSummary(db: DbLike, employeeId: number, year: number): { balances: LeaveBalance[]; recent: LeaveRequestView[] } {
  return {
    balances: balancesFor(db, employeeId, year),
    recent: requestViews(db, eq(leaveRequests.employeeId, employeeId), [desc(leaveRequests.createdAt), desc(leaveRequests.id)], 10),
  };
}
