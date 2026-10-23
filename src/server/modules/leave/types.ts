import { and, asc, count, eq, ne } from "drizzle-orm";
import type { EmploymentType } from "@/lib/hr";
import type { LeaveTypeInput } from "@/lib/validation/leave";
import type { DbLike } from "@/server/db/client";
import { leaveLedger, leaveTypes, type LeaveTypeRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";

export function getLeaveType(db: DbLike, id: number): LeaveTypeRow | undefined {
  return db.select().from(leaveTypes).where(eq(leaveTypes.id, id)).get();
}

export function requireLeaveType(db: DbLike, id: number): LeaveTypeRow {
  const row = getLeaveType(db, id);
  if (!row) throw new DomainError("NOT_FOUND", "Leave type not found.");
  return row;
}

export function listLeaveTypes(db: DbLike, { includeArchived = false }: { includeArchived?: boolean } = {}): LeaveTypeRow[] {
  return db
    .select()
    .from(leaveTypes)
    .where(includeArchived ? undefined : eq(leaveTypes.archived, false))
    .orderBy(asc(leaveTypes.sortOrder), asc(leaveTypes.id))
    .all();
}

/** The system comp-off type (spec §5.5). */
export function compOffType(db: DbLike): LeaveTypeRow | undefined {
  return db.select().from(leaveTypes).where(eq(leaveTypes.isCompOff, true)).get();
}

export function isApplicable(type: Pick<LeaveTypeRow, "applicableEmploymentTypes">, employmentType: EmploymentType): boolean {
  return type.applicableEmploymentTypes === null || type.applicableEmploymentTypes.includes(employmentType);
}

function assertCodeFree(db: DbLike, code: string, exceptId: number | null): void {
  const clash = db
    .select({ id: leaveTypes.id })
    .from(leaveTypes)
    .where(and(eq(leaveTypes.code, code), exceptId === null ? undefined : ne(leaveTypes.id, exceptId)))
    .get();
  if (clash) throw new DomainError("CODE_TAKEN", `Leave type code ${code} is already used.`, { code: ["Already used"] });
}

function hasLedger(db: DbLike, leaveTypeId: number): boolean {
  return (db.select({ n: count() }).from(leaveLedger).where(eq(leaveLedger.leaveTypeId, leaveTypeId)).get()?.n ?? 0) > 0;
}

export function createLeaveType(db: DbLike, input: LeaveTypeInput): LeaveTypeRow {
  assertCodeFree(db, input.code, null);
  const last = db.select({ n: count() }).from(leaveTypes).get()?.n ?? 0;
  return db.insert(leaveTypes).values({ ...input, sortOrder: last + 1 }).returning().get();
}

export function updateLeaveType(db: DbLike, id: number, input: LeaveTypeInput): { before: LeaveTypeRow; after: LeaveTypeRow } {
  const before = requireLeaveType(db, id);
  if (before.isCompOff && (input.code !== before.code || input.accrual !== "none" || input.annualQuota !== 0)) {
    throw new DomainError("SYSTEM_TYPE", "Comp-off is managed by the system: its code, accrual and quota cannot change.");
  }
  if (input.code !== before.code) {
    assertCodeFree(db, input.code, id);
    if (hasLedger(db, id)) {
      throw new DomainError("TYPE_IN_USE", "This code already appears in leave history, so it can't change.", { code: ["In use"] });
    }
  }
  const after = db.update(leaveTypes).set(input).where(eq(leaveTypes.id, id)).returning().get()!;
  return { before, after };
}

export function setLeaveTypeArchived(db: DbLike, id: number, archived: boolean): LeaveTypeRow {
  const row = requireLeaveType(db, id);
  if (row.isCompOff && archived) throw new DomainError("SYSTEM_TYPE", "Comp-off is managed by the system and can't be archived.");
  return db.update(leaveTypes).set({ archived }).where(eq(leaveTypes.id, id)).returning().get()!;
}

const DEFAULTS: (typeof leaveTypes.$inferInsert)[] = [
  {
    code: "CL", name: "Casual leave", color: "#2563eb", accrual: "upfront", annualQuota: 12, carryForwardMax: 6,
    maxConsecutiveDays: 3, minNoticeDays: 1, sortOrder: 1,
  },
  {
    code: "SL", name: "Sick leave", color: "#dc2626", accrual: "upfront", annualQuota: 6, carryForwardMax: 0,
    minNoticeDays: 0, attachmentAfterDays: 2, sortOrder: 2,
  },
  {
    code: "LWP", name: "Leave without pay", color: "#d97706", paid: false, isLop: true, accrual: "none", annualQuota: 0,
    allowNegative: true, sortOrder: 3,
  },
  {
    code: "CO", name: "Comp-off", color: "#92b353", accrual: "none", annualQuota: 0, isCompOff: true, sortOrder: 4,
  },
];

/** Spec §5.4 defaults. Idempotent by code; returns how many types were added. */
export function seedDefaultLeaveTypes(db: DbLike): number {
  let added = 0;
  for (const type of DEFAULTS) {
    if (db.select({ id: leaveTypes.id }).from(leaveTypes).where(eq(leaveTypes.code, type.code)).get()) continue;
    if (type.isCompOff && compOffType(db)) continue;
    db.insert(leaveTypes).values(type).run();
    added += 1;
  }
  return added;
}
