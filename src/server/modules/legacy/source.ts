import type Database from "better-sqlite3";
import { isLegacyDatabase } from "@/server/db/client";
import { DomainError } from "@/server/errors";

/** Rows of the old Holiday Tracker database (`git show 489c251:src/db/schema.ts`). */
export interface LegacyUser {
  id: number;
  name: string;
  email: string;
  passwordHash: string;
  role: "admin" | "employee";
  joinedDate: string;
  mustChangePassword: boolean;
  active: boolean;
  createdAt: string;
}

export interface LegacyHoliday {
  id: number;
  year: number;
  date: string;
  name: string;
  type: "fixed" | "optional";
}

export interface LegacySelection {
  userId: number;
  holidayId: number;
}

export interface LegacyLeave {
  id: number;
  userId: number;
  startDate: string;
  endDate: string;
  days: number;
  type: "casual" | "sick" | "unpaid";
  reason: string | null;
  status: "planned" | "taken" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface LegacyPolicy {
  year: number;
  casualPerYear: number;
  sickPerYear: number;
  carryFwdMax: number;
  maxConsecutiveDays: number;
  optionalHolidaysAllowed: number;
}

export interface LegacyBalanceRow {
  userId: number;
  year: number;
  carryForwardCl: number;
}

export interface LegacySource {
  users: LegacyUser[];
  holidays: LegacyHoliday[];
  selections: LegacySelection[];
  leaves: LegacyLeave[];
  policies: LegacyPolicy[];
  balances: LegacyBalanceRow[];
}

/** Loads everything the migration needs. Only reads; open the file with `{ readonly: true }`. */
export function readLegacy(sqlite: Database.Database): LegacySource {
  if (!isLegacyDatabase(sqlite)) {
    throw new DomainError("NOT_LEGACY", "This is not a Holiday Tracker database (it has no leave_policy table).");
  }
  const all = <T>(query: string) => sqlite.prepare(query).all() as T[];
  return {
    users: all<Omit<LegacyUser, "mustChangePassword" | "active"> & { mustChangePassword: number; active: number }>(
      `select id, name, email, password_hash as passwordHash, role, joined_date as joinedDate,
              must_change_password as mustChangePassword, active, created_at as createdAt
       from users order by id`,
    ).map((u) => ({ ...u, mustChangePassword: Boolean(u.mustChangePassword), active: Boolean(u.active) })),
    holidays: all<LegacyHoliday>("select id, year, date, name, type from holidays order by date"),
    selections: all<LegacySelection>("select user_id as userId, holiday_id as holidayId from holiday_selections order by user_id, holiday_id"),
    leaves: all<LegacyLeave>(
      `select id, user_id as userId, start_date as startDate, end_date as endDate, days, type, reason, status,
              created_at as createdAt, updated_at as updatedAt
       from leaves order by id`,
    ),
    policies: all<LegacyPolicy>(
      `select year, casual_per_year as casualPerYear, sick_per_year as sickPerYear, carry_fwd_max as carryFwdMax,
              max_consecutive_days as maxConsecutiveDays, optional_holidays_allowed as optionalHolidaysAllowed
       from leave_policy order by year`,
    ),
    balances: all<LegacyBalanceRow>("select user_id as userId, year, carry_forward_cl as carryForwardCl from user_year_balance"),
  };
}

/** The old `getPolicy`: the year's row, or the old defaults. */
export function legacyPolicy(source: Pick<LegacySource, "policies">, year: number): LegacyPolicy {
  return (
    source.policies.find((p) => p.year === year) ?? {
      year, casualPerYear: 12, sickPerYear: 6, carryFwdMax: 6, maxConsecutiveDays: 3, optionalHolidaysAllowed: 6,
    }
  );
}

export interface LegacyBalance {
  casualBalance: number;
  sickBalance: number;
  unpaidUsed: number;
  optionalUsed: number;
}

/**
 * The old `getUserBalance(userId, year)` (src/lib/leaves.ts at 489c251), over the loaded rows. Leaves count in the year
 * their start date falls in, compared as strings, so the old local-midnight timezone bug cannot creep in.
 */
export function legacyBalance(source: LegacySource, userId: number, year: number): LegacyBalance {
  const policy = legacyPolicy(source, year);
  const carryFwd = source.balances.find((b) => b.userId === userId && b.year === year)?.carryForwardCl ?? 0;
  let casual = 0;
  let sick = 0;
  let unpaid = 0;
  for (const leave of source.leaves) {
    if (leave.userId !== userId || leave.status === "cancelled") continue;
    if (leave.startDate < `${year}-01-01` || leave.startDate > `${year}-12-31`) continue;
    if (leave.type === "casual") casual += leave.days;
    else if (leave.type === "sick") sick += leave.days;
    else unpaid += leave.days;
  }
  const optionalIds = new Set(source.holidays.filter((h) => h.year === year && h.type === "optional").map((h) => h.id));
  const optionalUsed = source.selections.filter((s) => s.userId === userId && optionalIds.has(s.holidayId)).length;
  return {
    casualBalance: policy.casualPerYear + carryFwd - casual,
    sickBalance: policy.sickPerYear - sick,
    unpaidUsed: unpaid,
    optionalUsed,
  };
}

/** Leave years to migrate and verify for one user: policy years since joining, plus every year they have rows in. */
export function legacyYearsFor(source: LegacySource, user: LegacyUser): number[] {
  const joinYear = Number(user.joinedDate.slice(0, 4));
  const years = new Set(source.policies.map((p) => p.year).filter((y) => y >= joinYear));
  for (const leave of source.leaves) if (leave.userId === user.id) years.add(Number(leave.startDate.slice(0, 4)));
  for (const balance of source.balances) if (balance.userId === user.id) years.add(balance.year);
  return [...years].sort((a, b) => a - b);
}
