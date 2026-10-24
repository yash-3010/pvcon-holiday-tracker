import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { compOffDaysFor } from "@/lib/attendance";
import type { SessionUser } from "@/lib/auth/types";
import { addDays, dayOfWeek, diffDays, formatDate, type ISODate } from "@/lib/dates";
import { WEEKDAY_LABELS, formatDays, leaveYearOf } from "@/lib/leave";
import type { CompOffGrantInput } from "@/lib/validation/attendance";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import {
  attendanceDays, compOffClaims, compOffConsumptions, compOffLots, employees, users, type CompOffClaimRow, type CompOffLotRow,
  type LeaveRequestRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { approverUserIdsFor, canDecideFor, COMP_OFF_APPROVAL } from "@/server/modules/approvals/routing";
import { shiftForEmployee } from "@/server/modules/attendance/shifts";
import type { ScopeUser } from "@/server/modules/employees/scope";
import { requireEmployee } from "@/server/modules/employees/service";
import { leaveYearStartMonth, postLedger } from "@/server/modules/leave/ledger";
import { compOffType } from "@/server/modules/leave/types";
import { notify, notifyMany } from "@/server/modules/notifications/service";
import { getSetting } from "@/server/modules/settings/service";

/** Minutes of off-day work for a half and a full comp-off day: the settings, or the employee's shift (spec §5.5). */
export function compOffThresholds(db: DbLike, employeeId: number): { half: number; full: number } {
  const settings = getSetting(db, "compOff");
  const shift = shiftForEmployee(db, employeeId);
  return { half: settings.halfDayMinutes ?? shift.halfDayMinutes, full: settings.fullDayMinutes ?? shift.fullDayMinutes };
}

export function canDecideCompOff(db: DbLike, user: ScopeUser, employeeId: number): boolean {
  return canDecideFor(db, user, employeeId, COMP_OFF_APPROVAL);
}

const ACTIVE_CLAIM = inArray(compOffClaims.status, ["pending", "approved"]);
const dayLabel = (date: ISODate) => `${WEEKDAY_LABELS[dayOfWeek(date)]} ${formatDate(date, { day: "numeric", month: "short" })}`;

function activeClaimDates(db: DbLike, employeeId: number): Set<ISODate> {
  return new Set(
    db
      .select({ date: compOffClaims.workedDate })
      .from(compOffClaims)
      .where(and(eq(compOffClaims.employeeId, employeeId), ACTIVE_CLAIM))
      .all()
      .map((r) => r.date),
  );
}

export interface EligibleOffDay {
  date: ISODate;
  workedMinutes: number;
  days: 0.5 | 1;
}

/** Closed off days the employee worked long enough on, inside the claim window and not yet claimed. */
export function eligibleOffDays(db: DbLike, employeeId: number, { today }: { today: ISODate }): EligibleOffDay[] {
  const settings = getSetting(db, "compOff");
  if (!settings.enabled) return [];
  const thresholds = compOffThresholds(db, employeeId);
  const claimed = activeClaimDates(db, employeeId);
  return db
    .select({ date: attendanceDays.date, minutes: attendanceDays.workedMinutes })
    .from(attendanceDays)
    .where(
      and(
        eq(attendanceDays.employeeId, employeeId),
        eq(attendanceDays.offDayWorked, true),
        gte(attendanceDays.date, addDays(today, -settings.claimWindowDays)),
        lt(attendanceDays.date, today),
      ),
    )
    .orderBy(asc(attendanceDays.date))
    .all()
    .flatMap((d) => {
      const days = compOffDaysFor(d.minutes, thresholds);
      return days === 0 || claimed.has(d.date) ? [] : [{ date: d.date, workedMinutes: d.minutes, days }];
    });
}

export function submitCompOffClaim(
  db: DbLike,
  actor: SessionUser,
  { workedDate, reason }: { workedDate: ISODate; reason: string | null },
  { today }: { today: ISODate },
): CompOffClaimRow {
  const settings = getSetting(db, "compOff");
  if (!settings.enabled) throw new DomainError("COMPOFF_DISABLED", "Comp-off isn't offered at the moment.");
  if (actor.employeeId === null) throw new DomainError("NO_EMPLOYEE", "Your login isn't linked to an employee record.");
  const employee = requireEmployee(db, actor.employeeId);
  if (workedDate >= today) throw new DomainError("FUTURE_DATE", "Claim comp-off once the day is over.");
  if (diffDays(workedDate, today) > settings.claimWindowDays) {
    throw new DomainError("OUTSIDE_WINDOW", `Comp-off must be claimed within ${settings.claimWindowDays} days of the work.`);
  }
  const day = db
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.employeeId, employee.id), eq(attendanceDays.date, workedDate)))
    .get();
  if (!day?.offDayWorked) throw new DomainError("NOT_OFF_DAY_WORK", "There is no recorded work on a weekly off or holiday that day.");
  const days = compOffDaysFor(day.workedMinutes, compOffThresholds(db, employee.id));
  if (days === 0) throw new DomainError("TOO_FEW_MINUTES", "Not enough hours were worked that day for comp-off.");
  if (activeClaimDates(db, employee.id).has(workedDate)) throw new DomainError("ALREADY_CLAIMED", "This day has already been claimed.");

  const claim = db
    .insert(compOffClaims)
    .values({ employeeId: employee.id, workedDate, workedMinutes: day.workedMinutes, daysRequested: days, reason })
    .returning()
    .get();
  notifyMany(db, approverUserIdsFor(db, employee.id, COMP_OFF_APPROVAL), {
    type: "compoff.submitted",
    title: `${employee.displayName} claimed ${formatDays(days)} of comp-off for ${dayLabel(workedDate)}`,
    body: reason,
    link: "/approvals?tab=compoff",
  });
  return claim;
}

function requirePendingClaim(db: DbLike, actor: SessionUser, claimId: number): CompOffClaimRow {
  const claim = db.select().from(compOffClaims).where(eq(compOffClaims.id, claimId)).get();
  if (!claim) throw new DomainError("NOT_FOUND", "Claim not found.");
  if (claim.status !== "pending") throw new DomainError("NOT_PENDING", "This claim has already been decided.");
  if (actor.employeeId === claim.employeeId) throw new DomainError("SELF_APPROVAL", "Someone else has to decide on your own claim.");
  if (!canDecideCompOff(db, actor, claim.employeeId)) {
    throw new DomainError("FORBIDDEN", "You can only decide claims from people who report to you.");
  }
  return claim;
}

/** Notifies the employee's active login, if any; returns whether it was sent. */
function notifyEmployee(db: DbLike, employeeId: number, n: { type: string; title: string; body?: string | null }): boolean {
  const login = db
    .select({ userId: employees.userId, status: users.status })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.id, employeeId))
    .get();
  if (login?.status !== "active") return false;
  notify(db, { userId: login.userId!, ...n, link: "/me/comp-off" });
  return true;
}

/**
 * A lot of comp-off days with its expiry and the matching ledger credit. The credit goes to the leave year of `today`,
 * so a day worked before a year-end and approved after it is still usable.
 */
function createLot(
  db: DbLike,
  values: { employeeId: number; claimId: number | null; days: number; earnedOn: ISODate; note: string | null; createdBy: number | null },
  today: ISODate,
): CompOffLotRow {
  const type = compOffType(db);
  if (!type) throw new DomainError("COMPOFF_TYPE_MISSING", "The comp-off leave type is missing. Run the seed.");
  const expiresOn = addDays(values.earnedOn, getSetting(db, "compOff").expiryDays);
  const lot = db.insert(compOffLots).values({ ...values, remaining: values.days, expiresOn }).returning().get();
  postLedger(db, {
    employeeId: values.employeeId,
    leaveTypeId: type.id,
    year: leaveYearOf(today, leaveYearStartMonth(db)),
    date: today,
    delta: values.days,
    kind: "comp_off_credit",
    refType: "comp_off_lot",
    refId: lot.id,
    note: values.note,
    createdBy: values.createdBy,
  });
  return lot;
}

export function approveCompOffClaim(
  db: DbLike,
  actor: SessionUser,
  claimId: number,
  { resolution, note, today }: { resolution: "leave" | "payout"; note: string | null; today: ISODate },
): CompOffClaimRow {
  const claim = requirePendingClaim(db, actor, claimId);
  if (resolution === "payout" && !getSetting(db, "compOff").payoutEnabled) {
    throw new DomainError("PAYOUT_DISABLED", "Comp-off payout is switched off in the settings.");
  }
  if (resolution === "leave") {
    createLot(db, { employeeId: claim.employeeId, claimId, days: claim.daysRequested, earnedOn: claim.workedDate, note, createdBy: actor.id }, today);
  }
  const approved = db
    .update(compOffClaims)
    .set({ status: "approved", resolution, approverId: actor.id, decidedAt: nowIso(), decisionNote: note })
    .where(eq(compOffClaims.id, claimId))
    .returning()
    .get()!;
  notifyEmployee(db, claim.employeeId, {
    type: "compoff.approved",
    title:
      resolution === "leave"
        ? `${formatDays(claim.daysRequested)} of comp-off for ${dayLabel(claim.workedDate)} was approved`
        : `Comp-off for ${dayLabel(claim.workedDate)} will be paid with your next salary`,
    body: note,
  });
  return approved;
}

export function rejectCompOffClaim(db: DbLike, actor: SessionUser, claimId: number, note: string | null): CompOffClaimRow {
  const claim = requirePendingClaim(db, actor, claimId);
  const rejected = db
    .update(compOffClaims)
    .set({ status: "rejected", approverId: actor.id, decidedAt: nowIso(), decisionNote: note })
    .where(eq(compOffClaims.id, claimId))
    .returning()
    .get()!;
  notifyEmployee(db, claim.employeeId, {
    type: "compoff.rejected", title: `Your comp-off claim for ${dayLabel(claim.workedDate)} was not approved`, body: note,
  });
  return rejected;
}

export function withdrawCompOffClaim(db: DbLike, actor: SessionUser, claimId: number): CompOffClaimRow {
  const claim = db.select().from(compOffClaims).where(eq(compOffClaims.id, claimId)).get();
  if (!claim) throw new DomainError("NOT_FOUND", "Claim not found.");
  if (claim.employeeId !== actor.employeeId) throw new DomainError("FORBIDDEN", "You can only withdraw your own claims.");
  if (claim.status !== "pending") throw new DomainError("NOT_PENDING", "Only pending claims can be withdrawn.");
  return db.update(compOffClaims).set({ status: "withdrawn" }).where(eq(compOffClaims.id, claimId)).returning().get()!;
}

/** HR grants comp-off without a claim (spec §5.5), e.g. for work recorded elsewhere. */
export function grantCompOff(db: DbLike, actorUserId: number, input: CompOffGrantInput, { today }: { today: ISODate }): CompOffLotRow {
  const employee = requireEmployee(db, input.employeeId);
  if (input.earnedOn > today) throw new DomainError("FUTURE_DATE", "Grant comp-off for work already done.", { earnedOn: ["Not yet"] });
  if (input.earnedOn < employee.dateOfJoining || (employee.lastWorkingDate && input.earnedOn > employee.lastWorkingDate)) {
    throw new DomainError("NOT_EMPLOYED", "The employee wasn't employed on that date.", { earnedOn: ["Not employed"] });
  }
  if (addDays(input.earnedOn, getSetting(db, "compOff").expiryDays) < today) {
    throw new DomainError("ALREADY_EXPIRED", "Comp-off earned that long ago would already have expired.", { earnedOn: ["Too old"] });
  }
  return createLot(
    db,
    { employeeId: input.employeeId, claimId: null, days: input.days, earnedOn: input.earnedOn, note: input.note, createdBy: actorUserId },
    today,
  );
}

/** Comp-off days usable for leave starting on `onDate`: active lots that haven't expired by then. */
export function compOffAvailable(db: DbLike, employeeId: number, onDate: ISODate): number {
  return (
    db
      .select({ total: sql<number>`coalesce(sum(${compOffLots.remaining}), 0)` })
      .from(compOffLots)
      .where(and(eq(compOffLots.employeeId, employeeId), eq(compOffLots.status, "active"), gte(compOffLots.expiresOn, onDate)))
      .get()?.total ?? 0
  );
}

/**
 * Takes a CO leave request's days from the employee's lots, earliest expiry first (spec §5.5). Only lots still valid on
 * the leave's start date are used. Called when the leave is approved.
 */
export function consumeCompOff(db: DbLike, request: LeaveRequestRow): void {
  let needed = request.days;
  const usable = db
    .select()
    .from(compOffLots)
    .where(and(eq(compOffLots.employeeId, request.employeeId), eq(compOffLots.status, "active"), gte(compOffLots.expiresOn, request.startDate)))
    .orderBy(asc(compOffLots.expiresOn), asc(compOffLots.id))
    .all();
  for (const lot of usable) {
    if (needed <= 0) break;
    const take = Math.min(lot.remaining, needed);
    const remaining = lot.remaining - take;
    db.insert(compOffConsumptions).values({ lotId: lot.id, leaveRequestId: request.id, days: take }).run();
    db.update(compOffLots).set({ remaining, status: remaining === 0 ? "consumed" : "active" }).where(eq(compOffLots.id, lot.id)).run();
    needed -= take;
  }
  if (needed > 0) throw new DomainError("INSUFFICIENT_BALANCE", "Not enough comp-off is valid on those dates.");
}

/**
 * Gives a cancelled CO leave's days back to the lots they came from. Days whose lot has expired since lapse at once.
 */
export function restoreCompOff(db: DbLike, request: LeaveRequestRow, today: ISODate): void {
  const type = compOffType(db)!;
  const taken = db.select().from(compOffConsumptions).where(eq(compOffConsumptions.leaveRequestId, request.id)).all();
  for (const c of taken) {
    const lot = db.select().from(compOffLots).where(eq(compOffLots.id, c.lotId)).get()!;
    if (lot.expiresOn < today) {
      postLedger(db, {
        employeeId: lot.employeeId, leaveTypeId: type.id, year: leaveYearOf(today, leaveYearStartMonth(db)), date: today,
        delta: -c.days, kind: "comp_off_lapse", refType: "comp_off_lot", refId: lot.id, note: "Expired while the leave was booked",
      });
      db.update(compOffLots).set({ status: "expired" }).where(eq(compOffLots.id, lot.id)).run();
    } else {
      db.update(compOffLots).set({ remaining: lot.remaining + c.days, status: "active" }).where(eq(compOffLots.id, lot.id)).run();
    }
  }
  db.delete(compOffConsumptions).where(eq(compOffConsumptions.leaveRequestId, request.id)).run();
}

/**
 * Nightly (spec §5.5): lots past their expiry lapse what is left; lots expiring in exactly seven days trigger a warning.
 */
export function expireCompOff(db: DbLike, today: ISODate): { expired: number; warned: number } {
  const type = compOffType(db);
  if (!type) return { expired: 0, warned: 0 };
  const year = leaveYearOf(today, leaveYearStartMonth(db));
  const expiring = db
    .select()
    .from(compOffLots)
    .where(and(eq(compOffLots.status, "active"), lt(compOffLots.expiresOn, today)))
    .all();
  for (const lot of expiring) {
    if (lot.remaining > 0) {
      postLedger(db, {
        employeeId: lot.employeeId, leaveTypeId: type.id, year, date: today, delta: -lot.remaining, kind: "comp_off_lapse",
        refType: "comp_off_lot", refId: lot.id, note: `Expired on ${lot.expiresOn}`,
      });
    }
    db.update(compOffLots).set({ status: "expired", remaining: 0 }).where(eq(compOffLots.id, lot.id)).run();
  }

  const soon = addDays(today, 7);
  const dueSoon = db
    .select({ employeeId: compOffLots.employeeId, days: sql<number>`sum(${compOffLots.remaining})` })
    .from(compOffLots)
    .where(and(eq(compOffLots.status, "active"), eq(compOffLots.expiresOn, soon), sql`${compOffLots.remaining} > 0`))
    .groupBy(compOffLots.employeeId)
    .all();
  let warned = 0;
  for (const { employeeId, days } of dueSoon) {
    const sent = notifyEmployee(db, employeeId, {
      type: "compoff.expiring", title: `${formatDays(days)} of comp-off expires on ${formatDate(soon)}`,
      body: "Apply for comp-off leave before then, or it lapses.",
    });
    if (sent) warned += 1;
  }
  return { expired: expiring.length, warned };
}

/** Comp-off days still held in active lots, for the year-end carry. */
export function activeCompOffDays(db: DbLike, employeeId: number): number {
  return (
    db
      .select({ total: sql<number>`coalesce(sum(${compOffLots.remaining}), 0)` })
      .from(compOffLots)
      .where(and(eq(compOffLots.employeeId, employeeId), eq(compOffLots.status, "active")))
      .get()?.total ?? 0
  );
}
