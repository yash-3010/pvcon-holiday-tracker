import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { CompOffClaimStatus } from "@/lib/attendance";
import { can } from "@/lib/auth/permissions";
import type { ISODate } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import { compOffClaims, compOffLots, employees, type CompOffClaimRow, type CompOffLotRow } from "@/server/db/schema";
import type { ScopeUser } from "@/server/modules/employees/scope";
import { canDecideCompOff, compOffAvailable, eligibleOffDays, type EligibleOffDay } from "./service";

export interface MyCompOff {
  /** Usable today. */
  available: number;
  nextExpiry: { date: ISODate; days: number } | null;
  lots: CompOffLotRow[];
  claims: CompOffClaimRow[];
  eligible: EligibleOffDay[];
}

export function myCompOff(db: DbLike, employeeId: number, today: ISODate): MyCompOff {
  const lots = db.select().from(compOffLots).where(eq(compOffLots.employeeId, employeeId)).orderBy(desc(compOffLots.earnedOn), desc(compOffLots.id)).all();
  const next = lots
    .filter((l) => l.status === "active" && l.remaining > 0 && l.expiresOn >= today)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))[0];
  return {
    available: compOffAvailable(db, employeeId, today),
    nextExpiry: next ? { date: next.expiresOn, days: next.remaining } : null,
    lots,
    claims: db.select().from(compOffClaims).where(eq(compOffClaims.employeeId, employeeId)).orderBy(desc(compOffClaims.workedDate), desc(compOffClaims.id)).all(),
    eligible: eligibleOffDays(db, employeeId, { today }),
  };
}

export type CompOffClaimView = CompOffClaimRow & { employeeName: string; employeeCode: string };

function claimViews(db: DbLike, where: ReturnType<typeof and>, limit = 500): CompOffClaimView[] {
  return db
    .select({ claim: compOffClaims, employeeName: employees.displayName, employeeCode: employees.employeeCode })
    .from(compOffClaims)
    .innerJoin(employees, eq(employees.id, compOffClaims.employeeId))
    .where(where)
    .orderBy(asc(compOffClaims.createdAt), asc(compOffClaims.id))
    .limit(limit)
    .all()
    .map((r) => ({ ...r.claim, employeeName: r.employeeName, employeeCode: r.employeeCode }));
}

/** Pending claims `user` can decide, oldest first. */
export function pendingCompOffClaimsFor(db: DbLike, user: ScopeUser): CompOffClaimView[] {
  if (!can(user, "compoff.approve")) return [];
  return claimViews(db, and(eq(compOffClaims.status, "pending"))).filter((c) => canDecideCompOff(db, user, c.employeeId));
}

/** Admin list of claims (`leave.view.all`), optionally by status and worked-date range. */
export function listCompOffClaims(db: DbLike, filters: { status?: CompOffClaimStatus; from?: ISODate; to?: ISODate }): CompOffClaimView[] {
  return claimViews(
    db,
    and(
      filters.status ? eq(compOffClaims.status, filters.status) : undefined,
      filters.from ? gte(compOffClaims.workedDate, filters.from) : undefined,
      filters.to ? lte(compOffClaims.workedDate, filters.to) : undefined,
    ),
  ).reverse();
}

export type CompOffLotView = CompOffLotRow & { employeeName: string; employeeCode: string };

/** Admin list of lots, soonest expiry first; `active` only by default. */
export function listCompOffLots(db: DbLike, { includeClosed = false }: { includeClosed?: boolean } = {}): CompOffLotView[] {
  return db
    .select({ lot: compOffLots, employeeName: employees.displayName, employeeCode: employees.employeeCode })
    .from(compOffLots)
    .innerJoin(employees, eq(employees.id, compOffLots.employeeId))
    .where(includeClosed ? undefined : inArray(compOffLots.status, ["active"]))
    .orderBy(asc(compOffLots.expiresOn), asc(compOffLots.id))
    .all()
    .map((r) => ({ ...r.lot, employeeName: r.employeeName, employeeCode: r.employeeCode }));
}
