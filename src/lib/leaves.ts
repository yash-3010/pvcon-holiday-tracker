import { db } from "@/db";
import { leaves, holidays, holidaySelections, leavePolicy, userYearBalance, users } from "@/db/schema";
import { and, eq, gte, lte } from "drizzle-orm";

export type LeaveType = "casual" | "sick" | "unpaid";
export type LeaveStatus = "planned" | "taken" | "cancelled";

export function isWeekend(iso: string): boolean {
  const day = new Date(iso + "T00:00:00").getDay();
  return day === 0 || day === 6;
}

export function eachDateInclusive(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const start = new Date(startISO + "T00:00:00");
  const end = new Date(endISO + "T00:00:00");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function workingDaysBetween(startISO: string, endISO: string, holidayISOs: Set<string>): number {
  if (!startISO || !endISO) return 0;
  const days = eachDateInclusive(startISO, endISO);
  let count = 0;
  for (const d of days) {
    if (!isWeekend(d) && !holidayISOs.has(d)) count++;
  }
  return count;
}

export async function getYearHolidayDates(year: number): Promise<Set<string>> {
  const rows = await db.select().from(holidays).where(eq(holidays.year, year));
  return new Set(rows.map((r) => r.date));
}

export async function getPolicy(year: number) {
  const rows = await db.select().from(leavePolicy).where(eq(leavePolicy.year, year));
  return rows[0] ?? {
    year,
    casualPerYear: 12,
    sickPerYear: 6,
    carryFwdMax: 6,
    maxConsecutiveDays: 3,
    optionalHolidaysAllowed: 6,
  };
}

export async function getUserBalance(userId: number, year: number) {
  const policy = await getPolicy(year);
  const balRows = await db
    .select()
    .from(userYearBalance)
    .where(and(eq(userYearBalance.userId, userId), eq(userYearBalance.year, year)));
  const carryFwd = balRows[0]?.carryForwardCl ?? 0;

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const lvs = await db
    .select()
    .from(leaves)
    .where(
      and(
        eq(leaves.userId, userId),
        gte(leaves.startDate, yearStart),
        lte(leaves.startDate, yearEnd),
      )
    );

  let casual = 0, sick = 0, unpaid = 0;
  for (const l of lvs) {
    if (l.status === "cancelled") continue;
    if (l.type === "casual") casual += l.days;
    else if (l.type === "sick") sick += l.days;
    else unpaid += l.days;
  }

  // optional holiday selections count
  const sel = await db
    .select({ holidayId: holidaySelections.holidayId })
    .from(holidaySelections)
    .innerJoin(holidays, eq(holidays.id, holidaySelections.holidayId))
    .where(and(eq(holidaySelections.userId, userId), eq(holidays.year, year), eq(holidays.type, "optional")));

  return {
    policy,
    casualUsed: casual,
    casualTotal: policy.casualPerYear + carryFwd,
    casualBalance: policy.casualPerYear + carryFwd - casual,
    sickUsed: sick,
    sickTotal: policy.sickPerYear,
    sickBalance: policy.sickPerYear - sick,
    unpaidUsed: unpaid,
    optionalUsed: sel.length,
    optionalAllowed: policy.optionalHolidaysAllowed,
    carryFwd,
  };
}

export async function listUserLeaves(userId: number, year: number) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  return db
    .select()
    .from(leaves)
    .where(and(eq(leaves.userId, userId), gte(leaves.startDate, yearStart), lte(leaves.startDate, yearEnd)));
}

export async function listAllUsers() {
  return db.select().from(users);
}
