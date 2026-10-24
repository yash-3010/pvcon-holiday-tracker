import { eq } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/types";
import { formatDate, type ISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { CLAIM_CATEGORY_LABELS } from "@/lib/payroll/constants";
import type { ClaimInput } from "@/lib/validation/payroll";
import type { DbLike } from "@/server/db/client";
import { employees, expenseClaims, users, type ExpenseClaimRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { approverUserIdsFor, canDecideFor, CLAIM_APPROVAL } from "@/server/modules/approvals/routing";
import type { ScopeUser } from "@/server/modules/employees/scope";
import { requireEmployee } from "@/server/modules/employees/service";
import { notify, notifyMany } from "@/server/modules/notifications/service";

interface Clock {
  today: ISODate;
  now: Date;
}

export function canDecideClaim(db: DbLike, user: ScopeUser, employeeId: number): boolean {
  return canDecideFor(db, user, employeeId, CLAIM_APPROVAL);
}

export function requireClaim(db: DbLike, id: number): ExpenseClaimRow {
  const row = db.select().from(expenseClaims).where(eq(expenseClaims.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Claim not found.");
  return row;
}

const describeClaim = (c: Pick<ExpenseClaimRow, "category" | "claimDate" | "amount">) =>
  `${CLAIM_CATEGORY_LABELS[c.category]} on ${formatDate(c.claimDate)}, ${formatMoney(c.amount)}`;

function requireOwn(db: DbLike, actor: SessionUser, claimId: number): ExpenseClaimRow {
  const claim = requireClaim(db, claimId);
  if (claim.employeeId !== actor.employeeId) throw new DomainError("FORBIDDEN", "You can only change your own claims.");
  return claim;
}

/**
 * Creates (`claimId` null) or edits a draft claim of the actor's own (spec §5.6 "Loans & claims"). `receiptFileId`
 * undefined keeps the current receipt.
 */
export function saveClaim(
  db: DbLike,
  actor: SessionUser,
  claimId: number | null,
  input: ClaimInput & { receiptFileId: number | null | undefined },
  { today }: Clock,
): ExpenseClaimRow {
  if (actor.employeeId === null) throw new DomainError("NO_EMPLOYEE", "Your login isn't linked to an employee record.");
  const employee = requireEmployee(db, actor.employeeId);
  if (input.claimDate > today) throw new DomainError("FUTURE_DATE", "Claim expenses already spent.", { claimDate: ["In the future"] });
  if (input.claimDate < employee.dateOfJoining || (employee.lastWorkingDate && input.claimDate > employee.lastWorkingDate)) {
    throw new DomainError("NOT_EMPLOYED", "You weren't employed on that date.", { claimDate: ["Not employed"] });
  }
  const { receiptFileId, ...values } = input;
  if (claimId === null) {
    return db.insert(expenseClaims).values({ ...values, receiptFileId: receiptFileId ?? null, employeeId: employee.id }).returning().get();
  }
  const claim = requireOwn(db, actor, claimId);
  if (claim.status !== "draft") throw new DomainError("NOT_DRAFT", "Only a draft claim can be edited.");
  return db
    .update(expenseClaims)
    .set({ ...values, ...(receiptFileId === undefined ? {} : { receiptFileId }) })
    .where(eq(expenseClaims.id, claimId))
    .returning()
    .get()!;
}

export function deleteClaim(db: DbLike, actor: SessionUser, claimId: number): ExpenseClaimRow {
  const claim = requireOwn(db, actor, claimId);
  if (claim.status !== "draft") throw new DomainError("NOT_DRAFT", "Only a draft claim can be deleted.");
  db.delete(expenseClaims).where(eq(expenseClaims.id, claimId)).run();
  return claim;
}

/** Sends a draft with its receipt to the approvers: the reporting manager, else org-wide claim approvers. */
export function submitClaim(db: DbLike, actor: SessionUser, claimId: number, { now }: Clock): ExpenseClaimRow {
  const claim = requireOwn(db, actor, claimId);
  if (claim.status !== "draft") throw new DomainError("NOT_DRAFT", "This claim has already been submitted.");
  if (!claim.receiptFileId) throw new DomainError("NO_RECEIPT", "Attach the receipt first.", { receipt: ["Required"] });
  const submitted = db
    .update(expenseClaims)
    .set({ status: "submitted", submittedAt: now.toISOString() })
    .where(eq(expenseClaims.id, claimId))
    .returning()
    .get()!;
  const employee = requireEmployee(db, claim.employeeId);
  notifyMany(db, approverUserIdsFor(db, employee.id, CLAIM_APPROVAL), {
    type: "claim.submitted",
    title: `${employee.displayName} submitted an expense claim`,
    body: `${describeClaim(claim)} · ${claim.description}`,
    link: "/approvals?tab=claims",
  });
  return submitted;
}

/** Takes a submitted claim back to draft. */
export function withdrawClaim(db: DbLike, actor: SessionUser, claimId: number): ExpenseClaimRow {
  const claim = requireOwn(db, actor, claimId);
  if (claim.status !== "submitted") throw new DomainError("NOT_PENDING", "Only a submitted claim can be withdrawn.");
  return db.update(expenseClaims).set({ status: "draft", submittedAt: null }).where(eq(expenseClaims.id, claimId)).returning().get()!;
}

function requirePending(db: DbLike, actor: SessionUser, claimId: number): ExpenseClaimRow {
  const claim = requireClaim(db, claimId);
  if (claim.status !== "submitted") throw new DomainError("NOT_PENDING", "This claim has already been decided.");
  if (actor.employeeId === claim.employeeId) throw new DomainError("SELF_APPROVAL", "Someone else has to decide on your own claim.");
  if (!canDecideClaim(db, actor, claim.employeeId)) throw new DomainError("FORBIDDEN", "You can only decide claims from people who report to you.");
  return claim;
}

function notifyEmployee(db: DbLike, employeeId: number, n: { type: string; title: string; body?: string | null }): void {
  const login = db
    .select({ userId: employees.userId, status: users.status })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.id, employeeId))
    .get();
  if (login?.status === "active") notify(db, { userId: login.userId!, ...n, link: "/me/claims" });
}

/** Approved claims are paid with the next regular payroll run. */
export function approveClaim(db: DbLike, actor: SessionUser, claimId: number, note: string | null, { now }: Clock): ExpenseClaimRow {
  const claim = requirePending(db, actor, claimId);
  const approved = db
    .update(expenseClaims)
    .set({ status: "approved", approverId: actor.id, approvedAt: now.toISOString(), decisionNote: note })
    .where(eq(expenseClaims.id, claimId))
    .returning()
    .get()!;
  notifyEmployee(db, claim.employeeId, {
    type: "claim.approved", title: `Your claim for ${describeClaim(claim)} was approved`, body: note ?? "It will be paid with the next payroll.",
  });
  return approved;
}

export function rejectClaim(db: DbLike, actor: SessionUser, claimId: number, note: string | null): ExpenseClaimRow {
  if (!note?.trim()) throw new DomainError("NOTE_REQUIRED", "Say why the claim is rejected.", { note: ["Required"] });
  const claim = requirePending(db, actor, claimId);
  const rejected = db
    .update(expenseClaims)
    .set({ status: "rejected", approverId: actor.id, decisionNote: note })
    .where(eq(expenseClaims.id, claimId))
    .returning()
    .get()!;
  notifyEmployee(db, claim.employeeId, { type: "claim.rejected", title: `Your claim for ${describeClaim(claim)} was not approved`, body: note });
  return rejected;
}
