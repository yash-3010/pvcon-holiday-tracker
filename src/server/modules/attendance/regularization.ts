import { and, eq } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/types";
import { diffDays, formatDate, formatHm, zonedInstant, type ISODate } from "@/lib/dates";
import type { RegularizationInput } from "@/lib/validation/attendance";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import {
  attendanceDays, attendancePunches, employees, regularizationRequests, users, type RegularizationRequestRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { approverUserIdsFor, canDecideFor, REGULARIZATION_APPROVAL } from "@/server/modules/approvals/routing";
import type { ScopeUser } from "@/server/modules/employees/scope";
import { requireEmployee } from "@/server/modules/employees/service";
import { notify, notifyMany } from "@/server/modules/notifications/service";
import { getSetting } from "@/server/modules/settings/service";
import { recomputeAttendance, type RecomputeOptions } from "./compute";

export function canDecideRegularization(db: DbLike, user: ScopeUser, employeeId: number): boolean {
  return canDecideFor(db, user, employeeId, REGULARIZATION_APPROVAL);
}

function isLocked(db: DbLike, employeeId: number, date: ISODate): boolean {
  return !!db
    .select({ locked: attendanceDays.locked })
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, date), eq(attendanceDays.locked, true)))
    .get();
}

const describeRequest = (r: Pick<RegularizationRequestRow, "date" | "requestedIn" | "requestedOut">) =>
  `${formatDate(r.date)}, ${formatHm(r.requestedIn)}–${formatHm(r.requestedOut)}`;

/** Corrected in/out for a past day within the window (spec §5.2). */
export function requestRegularization(
  db: DbLike,
  actor: SessionUser,
  input: RegularizationInput,
  { today }: { today: ISODate },
): RegularizationRequestRow {
  if (actor.employeeId === null) throw new DomainError("NO_EMPLOYEE", "Your login isn't linked to an employee record.");
  const employee = requireEmployee(db, actor.employeeId);
  if (input.date >= today) throw new DomainError("FUTURE_DATE", "Use the clock for today; regularize only past days.", { date: ["Past days only"] });
  const window = getSetting(db, "attendance").regularizationWindowDays;
  if (diffDays(input.date, today) > window) {
    throw new DomainError("OUTSIDE_WINDOW", `Days older than ${window} days can't be regularized. Ask HR.`, { date: ["Too old"] });
  }
  if (input.date < employee.dateOfJoining || (employee.lastWorkingDate && input.date > employee.lastWorkingDate)) {
    throw new DomainError("NOT_EMPLOYED", "You weren't employed on that date.", { date: ["Not employed"] });
  }
  if (isLocked(db, employee.id, input.date)) throw new DomainError("DAY_LOCKED", "Payroll for this day is approved, so it can't change.");
  const pending = db
    .select({ id: regularizationRequests.id })
    .from(regularizationRequests)
    .where(
      and(
        eq(regularizationRequests.employeeId, employee.id),
        eq(regularizationRequests.date, input.date),
        eq(regularizationRequests.status, "pending"),
      ),
    )
    .get();
  if (pending) throw new DomainError("ALREADY_PENDING", "There is already a pending request for this day.");

  const row = db.insert(regularizationRequests).values({ ...input, employeeId: employee.id }).returning().get();
  notifyMany(db, approverUserIdsFor(db, employee.id, REGULARIZATION_APPROVAL), {
    type: "regularization.submitted",
    title: `${employee.displayName} asked to correct their attendance`,
    body: `${describeRequest(row)} · ${input.reason}`,
    link: "/approvals?tab=regularization",
  });
  return row;
}

function requirePending(db: DbLike, actor: SessionUser, requestId: number): RegularizationRequestRow {
  const request = db.select().from(regularizationRequests).where(eq(regularizationRequests.id, requestId)).get();
  if (!request) throw new DomainError("NOT_FOUND", "Request not found.");
  if (request.status !== "pending") throw new DomainError("NOT_PENDING", "This request has already been decided.");
  if (actor.employeeId === request.employeeId) throw new DomainError("SELF_APPROVAL", "Someone else has to decide on your own request.");
  if (!canDecideRegularization(db, actor, request.employeeId)) {
    throw new DomainError("FORBIDDEN", "You can only decide requests from people who report to you.");
  }
  return request;
}

function notifyEmployee(db: DbLike, employeeId: number, n: { type: string; title: string; body?: string | null }): void {
  const login = db
    .select({ userId: employees.userId, status: users.status })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.id, employeeId))
    .get();
  if (login?.status === "active") notify(db, { userId: login.userId!, ...n, link: "/me/attendance" });
}

/** Writes the corrected punches (replacing earlier corrections for the day) and recomputes it. */
export function approveRegularization(
  db: DbLike,
  actor: SessionUser,
  requestId: number,
  note: string | null,
  opts: RecomputeOptions = {},
): RegularizationRequestRow {
  const request = requirePending(db, actor, requestId);
  if (isLocked(db, request.employeeId, request.date)) {
    throw new DomainError("DAY_LOCKED", "Payroll for this day was approved meanwhile, so it can't change.");
  }
  const timeZone = getSetting(db, "locale").timezone;
  const day = and(
    eq(attendancePunches.employeeId, request.employeeId),
    eq(attendancePunches.date, request.date),
    eq(attendancePunches.source, "regularization"),
  );
  db.delete(attendancePunches).where(day).run();
  for (const [direction, minutes] of [["in", request.requestedIn], ["out", request.requestedOut]] as const) {
    db.insert(attendancePunches)
      .values({
        employeeId: request.employeeId, at: zonedInstant(request.date, minutes, timeZone).toISOString(), date: request.date,
        direction, source: "regularization", note: `Regularization #${request.id}`, createdBy: actor.id,
      })
      .run();
  }
  const approved = db
    .update(regularizationRequests)
    .set({ status: "approved", approverId: actor.id, decidedAt: nowIso(), decisionNote: note })
    .where(eq(regularizationRequests.id, requestId))
    .returning()
    .get()!;
  recomputeAttendance(db, request.employeeId, request.date, request.date, opts);
  notifyEmployee(db, request.employeeId, { type: "regularization.approved", title: `Your attendance for ${describeRequest(request)} was corrected`, body: note });
  return approved;
}

export function rejectRegularization(db: DbLike, actor: SessionUser, requestId: number, note: string | null): RegularizationRequestRow {
  const request = requirePending(db, actor, requestId);
  const rejected = db
    .update(regularizationRequests)
    .set({ status: "rejected", approverId: actor.id, decidedAt: nowIso(), decisionNote: note })
    .where(eq(regularizationRequests.id, requestId))
    .returning()
    .get()!;
  notifyEmployee(db, request.employeeId, { type: "regularization.rejected", title: `Your correction for ${describeRequest(request)} was not approved`, body: note });
  return rejected;
}

export function withdrawRegularization(db: DbLike, actor: SessionUser, requestId: number): RegularizationRequestRow {
  const request = db.select().from(regularizationRequests).where(eq(regularizationRequests.id, requestId)).get();
  if (!request) throw new DomainError("NOT_FOUND", "Request not found.");
  if (request.employeeId !== actor.employeeId) throw new DomainError("FORBIDDEN", "You can only withdraw your own requests.");
  if (request.status !== "pending") throw new DomainError("NOT_PENDING", "Only pending requests can be withdrawn.");
  return db.update(regularizationRequests).set({ status: "withdrawn" }).where(eq(regularizationRequests.id, requestId)).returning().get()!;
}
