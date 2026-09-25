import { and, asc, eq } from "drizzle-orm";
import type { BankInput } from "@/lib/validation/employees";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import { employees, profileChangeRequests, type ProfileChangeRequestRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { notify, notifyMany } from "@/server/modules/notifications/service";
import { activeUserIdsWithPermission } from "@/server/modules/users/service";
import { bankView, openBank, sealBank, type BankView } from "./sensitive";
import { requireEmployee, updateEmployeeBank } from "./service";

/** Blank requested values keep the employee's current value. */
function mergeBank(current: BankInput, requested: BankInput): BankInput {
  return {
    bankName: requested.bankName ?? current.bankName,
    bankAccount: requested.bankAccount ?? current.bankAccount,
    bankIfsc: requested.bankIfsc ?? current.bankIfsc,
    pan: requested.pan ?? current.pan,
    aadhaar: requested.aadhaar ?? current.aadhaar,
    passport: requested.passport ?? current.passport,
  };
}

function requireRequest(db: DbLike, id: number): ProfileChangeRequestRow {
  const row = db.select().from(profileChangeRequests).where(eq(profileChangeRequests.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Change request not found.");
  return row;
}

export function pendingProfileChangeFor(db: DbLike, employeeId: number): ProfileChangeRequestRow | undefined {
  return db
    .select()
    .from(profileChangeRequests)
    .where(and(eq(profileChangeRequests.employeeId, employeeId), eq(profileChangeRequests.status, "pending")))
    .get();
}

export function submitProfileChange(
  db: DbLike,
  employeeId: number,
  requestedBy: number,
  input: BankInput,
  reason: string | null,
): ProfileChangeRequestRow {
  const employee = requireEmployee(db, employeeId);
  if (employee.status === "exited") throw new DomainError("EMPLOYEE_EXITED", "Exited employees can't request changes.");
  if (Object.values(input).every((value) => value === null)) {
    throw new DomainError("NOTHING_TO_CHANGE", "Enter at least one new value.");
  }
  if (pendingProfileChangeFor(db, employeeId)) {
    throw new DomainError("PENDING_EXISTS", "You already have a pending change request. Withdraw it before sending another.");
  }
  const request = db
    .insert(profileChangeRequests)
    .values({ employeeId, fields: sealBank(input), reason, requestedBy })
    .returning()
    .get();
  const recipients = activeUserIdsWithPermission(db, "employee.update").filter((id) => id !== requestedBy);
  notifyMany(db, recipients, {
    type: "profile_change.submitted",
    title: `${employee.displayName} asked to change their bank details`,
    body: reason,
    link: "/approvals",
  });
  return request;
}

export function withdrawProfileChange(db: DbLike, employeeId: number, requestId: number): ProfileChangeRequestRow {
  const request = requireRequest(db, requestId);
  if (request.employeeId !== employeeId) throw new DomainError("NOT_FOUND", "Change request not found.");
  if (request.status !== "pending") throw new DomainError("NOT_PENDING", "This request is no longer pending.");
  return db
    .update(profileChangeRequests)
    .set({ status: "withdrawn", decidedAt: nowIso() })
    .where(eq(profileChangeRequests.id, requestId))
    .returning()
    .get()!;
}

/** Maker-checker: nobody decides a request for their own employee record or one they raised. */
export function decideProfileChange(
  db: DbLike,
  approverUserId: number,
  requestId: number,
  decision: "approved" | "rejected",
  note: string | null,
): { request: ProfileChangeRequestRow; before: BankView; after: BankView } {
  const request = requireRequest(db, requestId);
  if (request.status !== "pending") throw new DomainError("NOT_PENDING", "This request is no longer pending.");
  const employee = requireEmployee(db, request.employeeId);
  if (request.requestedBy === approverUserId || employee.userId === approverUserId) {
    throw new DomainError("SELF_APPROVAL", "Someone else has to decide on your own change request.");
  }
  let before = bankView(employee, false);
  let after = before;
  if (decision === "approved") {
    ({ before, after } = updateEmployeeBank(db, employee.id, mergeBank(openBank(employee), openBank(request.fields))));
  }
  const decided = db
    .update(profileChangeRequests)
    .set({ status: decision, approverId: approverUserId, decidedAt: nowIso(), note })
    .where(eq(profileChangeRequests.id, requestId))
    .returning()
    .get()!;
  if (employee.userId !== null) {
    notify(db, {
      userId: employee.userId,
      type: `profile_change.${decision}`,
      title: decision === "approved" ? "Your bank details change was approved" : "Your bank details change was rejected",
      body: note,
      link: "/me/profile",
    });
  }
  return { request: decided, before, after };
}

export interface PendingProfileChange {
  id: number;
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  reason: string | null;
  createdAt: string;
  current: BankView;
  /** Values the employee typed; null means "keep the current value". */
  requested: BankView;
}

/** Pass `reveal: true` only for viewers with `employee.sensitive.view`. */
export function listPendingProfileChanges(db: DbLike, reveal: boolean): PendingProfileChange[] {
  return db
    .select({ request: profileChangeRequests, employee: employees })
    .from(profileChangeRequests)
    .innerJoin(employees, eq(employees.id, profileChangeRequests.employeeId))
    .where(eq(profileChangeRequests.status, "pending"))
    .orderBy(asc(profileChangeRequests.createdAt), asc(profileChangeRequests.id))
    .all()
    .map(({ request, employee }) => ({
      id: request.id,
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: employee.displayName,
      reason: request.reason,
      createdAt: request.createdAt,
      current: bankView(employee, reveal),
      requested: bankView(request.fields, reveal),
    }));
}
