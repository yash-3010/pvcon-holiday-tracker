import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { addMonths, periodOf, type ISODate } from "@/lib/dates";
import {
  accrualCredit, leaveYearMonthIndex, leaveYearOf, leaveYearRange, proRatedQuota, type LedgerKind,
} from "@/lib/leave";
import type { AdjustmentInput } from "@/lib/validation/leave";
import type { DbLike } from "@/server/db/client";
import {
  employees, leaveLedger, leaveRequests, leaveTypes, type LeaveLedgerRow, type LeaveTypeRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { getSetting } from "@/server/modules/settings/service";
import { isApplicable, listLeaveTypes, requireLeaveType } from "./types";

export interface NewLedgerEntry {
  employeeId: number;
  leaveTypeId: number;
  year: number;
  date: ISODate;
  delta: number;
  kind: LedgerKind;
  refType?: string | null;
  refId?: number | null;
  note?: string | null;
  createdBy?: number | null;
}

export function postLedger(db: DbLike, entry: NewLedgerEntry): LeaveLedgerRow {
  if (!Number.isFinite(entry.delta)) throw new RangeError(`Invalid ledger delta: ${entry.delta}`);
  return db
    .insert(leaveLedger)
    .values({
      ...entry,
      refType: entry.refType ?? null,
      refId: entry.refId ?? null,
      note: entry.note ?? null,
      createdBy: entry.createdBy ?? null,
    })
    .returning()
    .get();
}

export function leaveYearStartMonth(db: DbLike): number {
  return getSetting(db, "leave").yearStartMonth;
}

export function balanceOf(db: DbLike, employeeId: number, leaveTypeId: number, year: number): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${leaveLedger.delta}), 0)` })
    .from(leaveLedger)
    .where(and(eq(leaveLedger.employeeId, employeeId), eq(leaveLedger.leaveTypeId, leaveTypeId), eq(leaveLedger.year, year)))
    .get();
  return row?.total ?? 0;
}

/** Days of pending requests of this type that start in leave year `year`. */
export function pendingDays(db: DbLike, employeeId: number, leaveTypeId: number, year: number, excludeRequestId?: number): number {
  const range = leaveYearRange(year, leaveYearStartMonth(db));
  const row = db
    .select({ total: sql<number>`coalesce(sum(${leaveRequests.days}), 0)` })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        eq(leaveRequests.leaveTypeId, leaveTypeId),
        eq(leaveRequests.status, "pending"),
        gte(leaveRequests.startDate, range.start),
        lte(leaveRequests.startDate, range.end),
        excludeRequestId === undefined ? undefined : ne(leaveRequests.id, excludeRequestId),
      ),
    )
    .get();
  return row?.total ?? 0;
}

export interface LeaveBalance {
  type: LeaveTypeRow;
  /** Carried forward into this year, plus opening balances. */
  opening: number;
  /** Grants, accruals and comp-off credits. */
  credited: number;
  /** Days taken, net of cancellations. */
  used: number;
  adjusted: number;
  /** Carried forward out of this year, lapsed, expired or encashed. */
  closed: number;
  balance: number;
  pending: number;
  /** Balance minus pending requests: what a new request may use. */
  available: number;
}

type Bucket = "opening" | "credited" | "used" | "adjusted" | "closed";

/** `carry_forward` is posted in pairs: −days out of the closing year, +days into the next. */
function bucketOf(kind: LedgerKind, delta: number): Bucket {
  switch (kind) {
    case "carry_forward":
      return delta > 0 ? "opening" : "closed";
    case "opening":
      return "opening";
    case "grant":
    case "accrual":
    case "comp_off_credit":
      return "credited";
    case "taken":
    case "cancelled":
      return "used";
    case "adjustment":
      return "adjusted";
    case "lapse":
    case "comp_off_lapse":
    case "encashment":
      return "closed";
  }
}

/** Every current leave type (plus archived ones with entries that year), in display order. */
export function balancesFor(db: DbLike, employeeId: number, year: number): LeaveBalance[] {
  const entries = db
    .select({ leaveTypeId: leaveLedger.leaveTypeId, kind: leaveLedger.kind, delta: leaveLedger.delta })
    .from(leaveLedger)
    .where(and(eq(leaveLedger.employeeId, employeeId), eq(leaveLedger.year, year)))
    .all();
  const withEntries = new Set(entries.map((e) => e.leaveTypeId));
  const types = listLeaveTypes(db, { includeArchived: true }).filter((t) => !t.archived || withEntries.has(t.id));

  return types.map((type) => {
    const sums: Record<Bucket, number> = { opening: 0, credited: 0, used: 0, adjusted: 0, closed: 0 };
    let balance = 0;
    for (const entry of entries) {
      if (entry.leaveTypeId !== type.id) continue;
      sums[bucketOf(entry.kind, entry.delta)] += entry.delta;
      balance += entry.delta;
    }
    const pending = pendingDays(db, employeeId, type.id, year);
    return {
      type,
      opening: sums.opening,
      credited: sums.credited,
      used: -sums.used || 0,
      adjusted: sums.adjusted,
      closed: -sums.closed || 0,
      balance,
      pending,
      available: balance - pending,
    };
  });
}

function hasEntry(
  db: DbLike,
  where: { employeeId: number; leaveTypeId: number; year?: number; kind?: LedgerKind; date?: ISODate; refType?: string; refId?: number },
): boolean {
  return !!db
    .select({ id: leaveLedger.id })
    .from(leaveLedger)
    .where(
      and(
        eq(leaveLedger.employeeId, where.employeeId),
        eq(leaveLedger.leaveTypeId, where.leaveTypeId),
        where.year === undefined ? undefined : eq(leaveLedger.year, where.year),
        where.kind === undefined ? undefined : eq(leaveLedger.kind, where.kind),
        where.date === undefined ? undefined : eq(leaveLedger.date, where.date),
        where.refType === undefined ? undefined : eq(leaveLedger.refType, where.refType),
        where.refId === undefined ? undefined : eq(leaveLedger.refId, where.refId),
      ),
    )
    .get();
}

/**
 * Posts the automatic credits due by `asOf` for the leave year containing it: the (pro-rated) upfront grant, and the
 * monthly accruals from the joining month to `asOf`'s month. Idempotent; safe to call from jobs and on create.
 */
export function syncEntitlements(db: DbLike, employeeId: number, asOf: ISODate): { granted: number; accrued: number } {
  const result = { granted: 0, accrued: 0 };
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!employee || employee.status === "exited") return result;

  const startMonth = leaveYearStartMonth(db);
  const year = leaveYearOf(asOf, startMonth);
  const range = leaveYearRange(year, startMonth);
  if (employee.dateOfJoining > range.end) return result;
  const joinIndex = employee.dateOfJoining < range.start ? 1 : leaveYearMonthIndex(employee.dateOfJoining, startMonth);
  const asOfIndex = leaveYearMonthIndex(asOf, startMonth);

  for (const type of listLeaveTypes(db)) {
    if (type.isCompOff || type.annualQuota <= 0 || !isApplicable(type, employee.employmentType)) continue;
    const key = { employeeId, leaveTypeId: type.id, year };

    if (type.accrual === "upfront" && !hasEntry(db, { ...key, kind: "grant" })) {
      const days = proRatedQuota(type.annualQuota, joinIndex);
      if (days > 0) {
        const date = employee.dateOfJoining > range.start ? employee.dateOfJoining : range.start;
        const note = joinIndex > 1 ? `Pro-rated from ${employee.dateOfJoining}` : null;
        postLedger(db, { ...key, date, delta: days, kind: "grant", note });
        result.granted += 1;
      }
    }

    if (type.accrual === "monthly") {
      for (let k = joinIndex; k <= asOfIndex; k++) {
        const date = `${addMonths(periodOf(range.start), k - 1)}-01`;
        if (hasEntry(db, { ...key, kind: "accrual", date })) continue;
        const days = accrualCredit(type.annualQuota, k);
        if (days > 0) {
          postLedger(db, { ...key, date, delta: days, kind: "accrual" });
          result.accrued += 1;
        }
      }
    }
  }
  return result;
}

/**
 * Year-end for one employee (spec §5.4): a positive balance carries forward up to the type's cap into the next leave
 * year and the rest lapses, so the closed year nets to zero and its days can't be spent twice. Comp-off is skipped: its lots expire on their own (Phase 3). Idempotent.
 * Encashable types also lapse the excess until Phase 5 adds encashment.
 */
export function closeLeaveYear(db: DbLike, employeeId: number, year: number): { carried: number; lapsed: number } {
  const result = { carried: 0, lapsed: 0 };
  const startMonth = leaveYearStartMonth(db);
  const range = leaveYearRange(year, startMonth);
  const next = leaveYearRange(year + 1, startMonth);
  const typeIds = db
    .selectDistinct({ id: leaveLedger.leaveTypeId })
    .from(leaveLedger)
    .where(and(eq(leaveLedger.employeeId, employeeId), eq(leaveLedger.year, year)))
    .all()
    .map((r) => r.id);

  for (const leaveTypeId of typeIds) {
    const type = db.select().from(leaveTypes).where(eq(leaveTypes.id, leaveTypeId)).get()!;
    if (type.isCompOff) continue;
    const ref = { refType: "year_end", refId: year };
    if (hasEntry(db, { employeeId, leaveTypeId, ...ref })) continue;
    const balance = balanceOf(db, employeeId, leaveTypeId, year);
    if (balance <= 0) continue;
    const carry = Math.min(balance, type.carryForwardMax);
    const lapse = balance - carry;
    if (carry > 0) {
      postLedger(db, { employeeId, leaveTypeId, year, date: range.end, delta: -carry, kind: "carry_forward", ...ref });
      postLedger(db, { employeeId, leaveTypeId, year: year + 1, date: next.start, delta: carry, kind: "carry_forward", ...ref });
      result.carried += carry;
    }
    if (lapse > 0) {
      postLedger(db, { employeeId, leaveTypeId, year, date: range.end, delta: -lapse, kind: "lapse", ...ref });
      result.lapsed += lapse;
    }
  }
  return result;
}

/** HR correction with a mandatory note (spec §5.4), dated `today` clamped into its leave year. */
export function adjustBalance(db: DbLike, actorUserId: number, input: AdjustmentInput, today: ISODate): LeaveLedgerRow {
  requireLeaveType(db, input.leaveTypeId);
  if (!db.select({ id: employees.id }).from(employees).where(eq(employees.id, input.employeeId)).get()) {
    throw new DomainError("NOT_FOUND", "Employee not found.");
  }
  const range = leaveYearRange(input.year, leaveYearStartMonth(db));
  return postLedger(db, {
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    year: input.year,
    date: today < range.start ? range.start : today > range.end ? range.end : today,
    delta: input.delta,
    kind: "adjustment",
    note: input.note,
    createdBy: actorUserId,
  });
}
