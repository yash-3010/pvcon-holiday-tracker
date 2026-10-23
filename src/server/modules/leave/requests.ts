import { and, eq, inArray } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { diffDays, formatDate, type ISODate } from "@/lib/dates";
import {
  countLeaveDays, formatDays, halvesError, leaveYearOf, portionsOverlap, requestPortions, type LeaveDay, type LeaveHalf,
} from "@/lib/leave";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import {
  employees, leaveRequests, users, type EmployeeRow, type LeaveRequestRow, type LeaveTypeRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { weeklyOffsForEmployee } from "@/server/modules/attendance/calendar";
import { onLeaveChanged } from "@/server/modules/attendance/hooks";
import { isManagerAbove, type ScopeUser } from "@/server/modules/employees/scope";
import { requireEmployee } from "@/server/modules/employees/service";
import { holidayDatesForEmployee } from "@/server/modules/holidays/service";
import { notify, notifyMany } from "@/server/modules/notifications/service";
import { activeUserIdsWithPermission } from "@/server/modules/users/service";
import { balanceOf, leaveYearStartMonth, pendingDays, postLedger } from "./ledger";
import { isApplicable, requireLeaveType } from "./types";

export interface LeaveRange {
  leaveTypeId: number;
  startDate: ISODate;
  endDate: ISODate;
  startHalf: LeaveHalf;
  endHalf: LeaveHalf;
}

export interface LeaveQuote {
  days: number;
  breakdown: LeaveDay[];
  /** The leave year the request belongs to. */
  year: number;
  balance: number;
  pending: number;
  available: number;
}

const APPLY_INVALID = (code: string, message: string, field?: string) =>
  new DomainError(code, message, field ? { [field]: [message] } : undefined);

/** Days, leave year and balance for a prospective request. Never writes. */
export function quoteLeave(db: DbLike, employeeId: number, range: LeaveRange, opts: { excludeRequestId?: number } = {}): LeaveQuote {
  const halves = halvesError(range.startDate, range.endDate, range.startHalf, range.endHalf);
  if (range.endDate < range.startDate) throw APPLY_INVALID("INVALID_DATES", "The end date is before the start date.", "endDate");
  if (halves) throw APPLY_INVALID("INVALID_HALVES", halves, "startHalf");
  const type = requireLeaveType(db, range.leaveTypeId);
  const startMonth = leaveYearStartMonth(db);
  const year = leaveYearOf(range.startDate, startMonth);
  if (leaveYearOf(range.endDate, startMonth) !== year) {
    throw APPLY_INVALID("CROSSES_LEAVE_YEAR", "Leave can't run across two leave years. Split it into two requests.", "endDate");
  }
  const { days, breakdown } = countLeaveDays({
    start: range.startDate,
    end: range.endDate,
    startHalf: range.startHalf,
    endHalf: range.endHalf,
    weeklyOffs: weeklyOffsForEmployee(db, employeeId),
    holidays: holidayDatesForEmployee(db, employeeId, range.startDate, range.endDate),
    countWeekends: type.countWeekends,
  });
  const balance = balanceOf(db, employeeId, type.id, year);
  const pending = pendingDays(db, employeeId, type.id, year, opts.excludeRequestId);
  return { days, breakdown, year, balance, pending, available: balance - pending };
}

function describeRange(r: Pick<LeaveRequestRow, "startDate" | "endDate">): string {
  return r.startDate === r.endDate ? formatDate(r.startDate) : `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`;
}

function assertNoOverlap(db: DbLike, employeeId: number, range: LeaveRange): void {
  const mine = requestPortions(range.startDate, range.endDate, range.startHalf, range.endHalf);
  const others = db
    .select()
    .from(leaveRequests)
    .where(and(eq(leaveRequests.employeeId, employeeId), inArray(leaveRequests.status, ["pending", "approved"])))
    .all()
    .filter((r) => r.startDate <= range.endDate && r.endDate >= range.startDate);
  for (const other of others) {
    if (portionsOverlap(mine, requestPortions(other.startDate, other.endDate, other.startHalf, other.endHalf))) {
      throw APPLY_INVALID("OVERLAP", `This overlaps your ${other.status} leave on ${describeRange(other)}.`, "startDate");
    }
  }
}

function assertBalance(type: LeaveTypeRow, days: number, available: number): void {
  if (type.allowNegative || days <= available) return;
  throw new DomainError(
    "INSUFFICIENT_BALANCE",
    `Not enough ${type.name}: ${formatDays(Math.max(available, 0))} available, ${formatDays(days)} requested.`,
  );
}

/** Spec §5.4 apply rules. Self-service requests also get the notice and length rules. */
function checkApplication(
  db: DbLike,
  employee: EmployeeRow,
  range: LeaveRange,
  opts: { selfService: boolean; today: ISODate; hasAttachment: boolean },
): { type: LeaveTypeRow; quote: LeaveQuote } {
  if (employee.status === "exited") throw new DomainError("EMPLOYEE_INACTIVE", "This employee has left the company.");
  const type = requireLeaveType(db, range.leaveTypeId);
  if (type.archived) throw APPLY_INVALID("TYPE_UNAVAILABLE", `${type.name} is no longer offered.`, "leaveTypeId");
  if (!isApplicable(type, employee.employmentType)) {
    throw APPLY_INVALID("TYPE_NOT_APPLICABLE", `${type.name} isn't available for this employment type.`, "leaveTypeId");
  }
  if (!type.allowHalfDay && (range.startHalf !== "full" || range.endHalf !== "full")) {
    throw APPLY_INVALID("HALF_DAY_NOT_ALLOWED", `${type.name} can only be taken in full days.`, "startHalf");
  }
  if (range.startDate < employee.dateOfJoining) {
    throw APPLY_INVALID("BEFORE_JOINING", `Leave can't start before the joining date (${formatDate(employee.dateOfJoining)}).`, "startDate");
  }
  if (employee.lastWorkingDate && range.endDate > employee.lastWorkingDate) {
    throw APPLY_INVALID("AFTER_LAST_DAY", `Leave can't run past the last working day (${formatDate(employee.lastWorkingDate)}).`, "endDate");
  }
  const quote = quoteLeave(db, employee.id, range);
  if (quote.days <= 0) {
    throw APPLY_INVALID("NO_WORKING_DAYS", "These dates are all weekly offs or holidays, so there is nothing to take.", "startDate");
  }
  assertNoOverlap(db, employee.id, range);
  if (opts.selfService) {
    if (type.maxConsecutiveDays !== null && quote.days > type.maxConsecutiveDays) {
      throw APPLY_INVALID("TOO_MANY_DAYS", `${type.name} allows at most ${formatDays(type.maxConsecutiveDays)} in one request.`, "endDate");
    }
    const notice = diffDays(opts.today, range.startDate);
    if (notice < 0 && type.minNoticeDays > 0) {
      throw APPLY_INVALID("BACKDATED_NOT_ALLOWED", `${type.name} can't be applied for past dates. Ask HR to record it.`, "startDate");
    }
    if (notice >= 0 && notice < type.minNoticeDays) {
      throw APPLY_INVALID("NOTICE_REQUIRED", `${type.name} needs ${type.minNoticeDays} day(s) of notice.`, "startDate");
    }
  }
  if (type.attachmentAfterDays !== null && quote.days > type.attachmentAfterDays && !opts.hasAttachment) {
    throw APPLY_INVALID(
      "ATTACHMENT_REQUIRED",
      `Attach a supporting document for ${type.name} longer than ${formatDays(type.attachmentAfterDays)}.`,
      "attachment",
    );
  }
  assertBalance(type, quote.days, quote.available);
  return { type, quote };
}

/** Who should decide a request: the reporting manager's login, otherwise org-wide leave approvers (HR). */
export function leaveApproverUserIds(db: DbLike, employeeId: number): number[] {
  const employee = requireEmployee(db, employeeId);
  if (employee.reportingManagerId !== null) {
    const manager = db
      .select({ userId: employees.userId, status: employees.status, userStatus: users.status })
      .from(employees)
      .leftJoin(users, eq(users.id, employees.userId))
      .where(eq(employees.id, employee.reportingManagerId))
      .get();
    if (manager?.userId && manager.status !== "exited" && manager.userStatus === "active" && manager.userId !== employee.userId) {
      return [manager.userId];
    }
  }
  const orgWide = new Set(activeUserIdsWithPermission(db, "leave.view.all"));
  return activeUserIdsWithPermission(db, "leave.approve").filter((id) => orgWide.has(id) && id !== employee.userId);
}

/**
 * True when `user` may approve or reject `employeeId`'s leave: an approver who is org-wide (`leave.view.all`) or a
 * manager above them. Never for one's own leave, even for org-wide approvers.
 */
export function canDecideLeave(db: DbLike, user: ScopeUser, employeeId: number): boolean {
  if (user.employeeId === employeeId || !can(user, "leave.approve")) return false;
  return can(user, "leave.view.all") || isManagerAbove(db, user, employeeId);
}

function requireRequest(db: DbLike, id: number): LeaveRequestRow {
  const row = db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Leave request not found.");
  return row;
}

function assertCanDecide(db: DbLike, actor: SessionUser, request: LeaveRequestRow): void {
  if (request.status !== "pending") throw new DomainError("NOT_PENDING", "This request has already been decided.");
  if (actor.employeeId === request.employeeId) {
    throw new DomainError("SELF_APPROVAL", "Someone else has to decide on your own leave.");
  }
  if (!canDecideLeave(db, actor, request.employeeId)) {
    throw new DomainError("FORBIDDEN", "You can only decide leave for people who report to you.");
  }
}

/** The employee's login, if they have an active one. */
function employeeUserId(db: DbLike, employeeId: number): number | null {
  const row = db
    .select({ userId: employees.userId, status: users.status })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.id, employeeId))
    .get();
  return row && row.status === "active" ? row.userId : null;
}

function postTaken(db: DbLike, request: LeaveRequestRow, actorUserId: number): void {
  postLedger(db, {
    employeeId: request.employeeId,
    leaveTypeId: request.leaveTypeId,
    year: leaveYearOf(request.startDate, leaveYearStartMonth(db)),
    date: request.startDate,
    delta: -request.days,
    kind: "taken",
    refType: "leave_request",
    refId: request.id,
    createdBy: actorUserId,
  });
  onLeaveChanged(db, request.employeeId, request.startDate, request.endDate);
}

export interface ApplyOptions {
  today: ISODate;
  attachmentFileId: number | null;
}

/** Self-service request for the actor's own employee record: pending until the approver decides. */
export function applyLeave(
  db: DbLike,
  actor: SessionUser,
  input: LeaveRange & { reason: string | null },
  opts: ApplyOptions,
): LeaveRequestRow {
  if (actor.employeeId === null) throw new DomainError("NO_EMPLOYEE", "Your login isn't linked to an employee record.");
  const employee = requireEmployee(db, actor.employeeId);
  const { type, quote } = checkApplication(db, employee, input, {
    selfService: true, today: opts.today, hasAttachment: opts.attachmentFileId !== null,
  });
  const request = db
    .insert(leaveRequests)
    .values({
      employeeId: employee.id, leaveTypeId: type.id, startDate: input.startDate, endDate: input.endDate,
      startHalf: input.startHalf, endHalf: input.endHalf, days: quote.days, reason: input.reason,
      attachmentFileId: opts.attachmentFileId, appliedBy: actor.id,
    })
    .returning()
    .get();
  notifyMany(db, leaveApproverUserIds(db, employee.id), {
    type: "leave.submitted",
    title: `${employee.displayName} requested ${formatDays(quote.days)} of ${type.name}`,
    body: describeRange(request) + (input.reason ? ` · ${input.reason}` : ""),
    link: "/approvals?tab=leave",
  });
  return request;
}

/** HR records leave for an employee (`leave.adjust`): approved at once, without the notice and length rules. */
export function applyLeaveOnBehalf(
  db: DbLike,
  actor: SessionUser,
  input: LeaveRange & { employeeId: number; reason: string | null },
  opts: ApplyOptions,
): LeaveRequestRow {
  if (actor.employeeId === input.employeeId) {
    throw new DomainError("SELF_APPROVAL", "Ask someone else to record your own leave, or apply from My leave.");
  }
  const employee = requireEmployee(db, input.employeeId);
  const { type, quote } = checkApplication(db, employee, input, {
    selfService: false, today: opts.today, hasAttachment: opts.attachmentFileId !== null,
  });
  const now = nowIso();
  const request = db
    .insert(leaveRequests)
    .values({
      employeeId: employee.id, leaveTypeId: type.id, startDate: input.startDate, endDate: input.endDate,
      startHalf: input.startHalf, endHalf: input.endHalf, days: quote.days, reason: input.reason,
      attachmentFileId: opts.attachmentFileId, appliedBy: actor.id, status: "approved", approverId: actor.id, decidedAt: now,
    })
    .returning()
    .get();
  postTaken(db, request, actor.id);
  const userId = employeeUserId(db, employee.id);
  if (userId !== null) {
    notify(db, {
      userId, type: "leave.recorded", title: `HR recorded ${formatDays(quote.days)} of ${type.name} for you`,
      body: describeRange(request), link: "/me/leave",
    });
  }
  return request;
}

export function approveLeave(db: DbLike, actor: SessionUser, requestId: number, note: string | null): LeaveRequestRow {
  const request = requireRequest(db, requestId);
  assertCanDecide(db, actor, request);
  const type = requireLeaveType(db, request.leaveTypeId);
  const balance = balanceOf(db, request.employeeId, type.id, leaveYearOf(request.startDate, leaveYearStartMonth(db)));
  assertBalance(type, request.days, balance);
  const approved = db
    .update(leaveRequests)
    .set({ status: "approved", approverId: actor.id, decidedAt: nowIso(), decisionNote: note })
    .where(eq(leaveRequests.id, requestId))
    .returning()
    .get()!;
  postTaken(db, approved, actor.id);
  const userId = employeeUserId(db, request.employeeId);
  if (userId !== null) {
    notify(db, {
      userId, type: "leave.approved", title: `Your ${type.name} for ${describeRange(request)} was approved`,
      body: note, link: "/me/leave",
    });
  }
  return approved;
}

export function rejectLeave(db: DbLike, actor: SessionUser, requestId: number, note: string | null): LeaveRequestRow {
  const request = requireRequest(db, requestId);
  assertCanDecide(db, actor, request);
  const type = requireLeaveType(db, request.leaveTypeId);
  const rejected = db
    .update(leaveRequests)
    .set({ status: "rejected", approverId: actor.id, decidedAt: nowIso(), decisionNote: note })
    .where(eq(leaveRequests.id, requestId))
    .returning()
    .get()!;
  const userId = employeeUserId(db, request.employeeId);
  if (userId !== null) {
    notify(db, {
      userId, type: "leave.rejected", title: `Your ${type.name} for ${describeRange(request)} was not approved`,
      body: note, link: "/me/leave",
    });
  }
  return rejected;
}

/** One savepoint per request, so one failure does not undo the others. */
export function bulkApproveLeave(
  db: DbLike,
  actor: SessionUser,
  requestIds: number[],
  note: string | null,
): { approved: number[]; failed: { id: number; error: string }[] } {
  const result: { approved: number[]; failed: { id: number; error: string }[] } = { approved: [], failed: [] };
  for (const id of requestIds) {
    try {
      db.transaction((tx) => approveLeave(tx, actor, id, note));
      result.approved.push(id);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      result.failed.push({ id, error: err.message });
    }
  }
  return result;
}

export function withdrawLeave(db: DbLike, actor: SessionUser, requestId: number): LeaveRequestRow {
  const request = requireRequest(db, requestId);
  if (request.employeeId !== actor.employeeId) throw new DomainError("FORBIDDEN", "You can only withdraw your own requests.");
  if (request.status !== "pending") throw new DomainError("NOT_PENDING", "Only pending requests can be withdrawn.");
  return db.update(leaveRequests).set({ status: "withdrawn" }).where(eq(leaveRequests.id, requestId)).returning().get()!;
}

/**
 * Cancels approved leave and gives the days back (spec §5.4): employees cancel their own leave before it starts;
 * HR (`leave.adjust`) cancels anyone else's at any time.
 */
export function cancelLeave(
  db: DbLike,
  actor: SessionUser,
  requestId: number,
  note: string | null,
  { today }: { today: ISODate },
): LeaveRequestRow {
  const request = requireRequest(db, requestId);
  if (request.status !== "approved") throw new DomainError("NOT_APPROVED", "Only approved leave can be cancelled.");
  const own = request.employeeId === actor.employeeId;
  if (own && request.startDate <= today) {
    throw new DomainError("CANCEL_NOT_ALLOWED", "Leave that has started can only be cancelled by HR.");
  }
  if (!own && !can(actor, "leave.adjust")) throw new DomainError("FORBIDDEN", "Only HR can cancel someone else's leave.");

  const type = requireLeaveType(db, request.leaveTypeId);
  const cancelled = db
    .update(leaveRequests)
    .set({ status: "cancelled", cancelledBy: actor.id, cancelledAt: nowIso(), cancelNote: note })
    .where(eq(leaveRequests.id, requestId))
    .returning()
    .get()!;
  postLedger(db, {
    employeeId: request.employeeId,
    leaveTypeId: request.leaveTypeId,
    year: leaveYearOf(request.startDate, leaveYearStartMonth(db)),
    date: today,
    delta: request.days,
    kind: "cancelled",
    refType: "leave_request",
    refId: request.id,
    createdBy: actor.id,
  });
  onLeaveChanged(db, request.employeeId, request.startDate, request.endDate);

  if (own) {
    if (request.approverId !== null && request.approverId !== actor.id) {
      const employee = requireEmployee(db, request.employeeId);
      notify(db, {
        userId: request.approverId, type: "leave.cancelled",
        title: `${employee.displayName} cancelled ${type.name} for ${describeRange(request)}`, body: note, link: "/leave/requests",
      });
    }
  } else {
    const userId = employeeUserId(db, request.employeeId);
    if (userId !== null) {
      notify(db, {
        userId, type: "leave.cancelled", title: `Your ${type.name} for ${describeRange(request)} was cancelled`,
        body: note, link: "/me/leave",
      });
    }
  }
  return cancelled;
}
