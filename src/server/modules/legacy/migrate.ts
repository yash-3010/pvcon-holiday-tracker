import { eq } from "drizzle-orm";
import type { Role } from "@/lib/auth/permissions";
import { fullName } from "@/lib/hr";
import type { LeaveHalf } from "@/lib/leave";
import type { DB, DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import { employees, holidaySelections, holidays, leaveRequests, leaveTypes, users } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { seedDefaultChecklistTemplates } from "@/server/modules/employees/checklists";
import { nextEmployeeCode } from "@/server/modules/employees/code";
import { recordEmployeeEvent } from "@/server/modules/employees/service";
import { setYearConfig } from "@/server/modules/holidays/service";
import { postLedger } from "@/server/modules/leave/ledger";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { createUser } from "@/server/modules/users/service";
import { legacyPolicy, legacyYearsFor, type LegacyLeave, type LegacySource, type LegacyUser } from "./source";

const NOTE = "Migrated from Holiday Tracker";

export interface MigrationReport {
  users: number;
  superAdmins: number;
  employees: number;
  exitedEmployees: number;
  /** Old admins who had leave history, so they also got an employee record. */
  adminsWithEmployeeRecord: string[];
  holidays: number;
  optionalSelections: number;
  /** Picks by admins without an employee record; nothing to attach them to. */
  droppedSelections: number;
  leaveRequests: { approved: number; cancelled: number };
  ledgerEntries: number;
  years: number[];
}

/** Old user id → new user and employee ids. */
export type MigrationMap = Map<number, { userId: number; employeeId: number | null }>;

/** "2026-01-10 08:00:00" (SQLite CURRENT_TIMESTAMP, UTC) or an ISO string → ISO-8601 UTC. */
export function legacyTimestamp(value: string | null | undefined): string {
  if (!value) return nowIso();
  const sqliteFormat = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
  if (sqliteFormat) return `${sqliteFormat[1]}T${sqliteFormat[2]}.000Z`;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? nowIso() : new Date(parsed).toISOString();
}

function splitName(name: string): { firstName: string; lastName: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const space = trimmed.indexOf(" ");
  return space === -1 ? { firstName: trimmed, lastName: "" } : { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1) };
}

/** Employees, and admins with leave history (a working person, not just the system account), get a record. */
function needsEmployee(source: LegacySource, user: LegacyUser): boolean {
  return user.role === "employee" || source.leaves.some((l) => l.userId === user.id);
}

/** A single 0.5-day leave becomes a first-half request; other fractions keep their recorded days on full days. */
function halvesFor(leave: LegacyLeave): LeaveHalf {
  return leave.startDate === leave.endDate && leave.days === 0.5 ? "first_half" : "full";
}

/**
 * Copies the old Holiday Tracker data into a freshly migrated database (spec §8, steps 1–6 and 9; attendance comes in
 * Phase 3). Runs in one transaction. Seeds leave types and checklist templates, but not the seed admin: old admins
 * become super admins.
 */
export function migrateLegacy(source: LegacySource, db: DB): { report: MigrationReport; map: MigrationMap } {
  return db.transaction((tx) => run(source, tx));
}

function run(source: LegacySource, db: DbLike): { report: MigrationReport; map: MigrationMap } {
  const report: MigrationReport = {
    users: 0, superAdmins: 0, employees: 0, exitedEmployees: 0, adminsWithEmployeeRecord: [], holidays: 0,
    optionalSelections: 0, droppedSelections: 0, leaveRequests: { approved: 0, cancelled: 0 }, ledgerEntries: 0, years: [],
  };
  const map: MigrationMap = new Map();
  seedDefaultChecklistTemplates(db);
  seedDefaultLeaveTypes(db);
  // Auto mode: migrated people have no punches, so their history must not read as absent (spec §8 step 7).
  seedDefaultShift(db, { attendanceMode: "auto" });

  // 1. Leave types follow the most recent policy year.
  const latest = source.policies.at(-1) ?? legacyPolicy(source, new Date().getUTCFullYear());
  const typeId = (code: string) => db.select({ id: leaveTypes.id }).from(leaveTypes).where(eq(leaveTypes.code, code)).get()!.id;
  const CL = typeId("CL");
  const SL = typeId("SL");
  const LWP = typeId("LWP");
  db.update(leaveTypes)
    .set({ annualQuota: latest.casualPerYear, carryForwardMax: latest.carryFwdMax, maxConsecutiveDays: latest.maxConsecutiveDays })
    .where(eq(leaveTypes.id, CL))
    .run();
  db.update(leaveTypes).set({ annualQuota: latest.sickPerYear }).where(eq(leaveTypes.id, SL)).run();

  // 2. Optional-holiday allowance per year; years with holidays but no policy row had the old default.
  const configYears = new Set([...source.policies.map((p) => p.year), ...source.holidays.map((h) => h.year)]);
  for (const year of [...configYears].sort()) setYearConfig(db, year, legacyPolicy(source, year).optionalHolidaysAllowed);

  // 3–4. Logins, and employee records in old id order (so codes follow it).
  for (const user of source.users) {
    const isAdmin = user.role === "admin";
    const withEmployee = needsEmployee(source, user);
    const roles: Role[] = isAdmin ? (withEmployee ? ["super_admin", "employee"] : ["super_admin"]) : ["employee"];
    const created = createUser(db, {
      email: user.email, name: user.name, roles, passwordHash: user.passwordHash, mustChangePassword: user.mustChangePassword,
    });
    db.update(users)
      .set({ status: user.active ? "active" : "disabled", createdAt: legacyTimestamp(user.createdAt) })
      .where(eq(users.id, created.id))
      .run();
    report.users += 1;
    if (isAdmin) report.superAdmins += 1;

    let employeeId: number | null = null;
    if (withEmployee) {
      const { firstName, lastName } = splitName(user.name);
      const employee = db
        .insert(employees)
        .values({
          employeeCode: nextEmployeeCode(db),
          firstName,
          lastName,
          displayName: fullName(firstName, lastName),
          workEmail: created.email,
          dateOfJoining: user.joinedDate,
          userId: created.id,
          status: user.active ? "active" : "exited",
          exitReason: user.active ? null : "Migrated inactive account",
        })
        .returning()
        .get();
      recordEmployeeEvent(db, { employeeId: employee.id, type: "joined", effectiveDate: employee.dateOfJoining, note: NOTE, createdBy: null });
      employeeId = employee.id;
      report.employees += 1;
      if (!user.active) report.exitedEmployees += 1;
      if (isAdmin) report.adminsWithEmployeeRecord.push(created.email);
    }
    map.set(user.id, { userId: created.id, employeeId });
  }

  // 5. Holidays and picks.
  const holidayIds = new Map<number, number>();
  for (const holiday of source.holidays) {
    const row = db
      .insert(holidays)
      .values({ year: Number(holiday.date.slice(0, 4)), date: holiday.date, name: holiday.name, type: holiday.type })
      .returning()
      .get();
    holidayIds.set(holiday.id, row.id);
    report.holidays += 1;
  }
  for (const pick of source.selections) {
    const employeeId = map.get(pick.userId)?.employeeId ?? null;
    const holidayId = holidayIds.get(pick.holidayId);
    if (employeeId === null || holidayId === undefined) {
      report.droppedSelections += 1;
      continue;
    }
    db.insert(holidaySelections).values({ employeeId, holidayId }).run();
    report.optionalSelections += 1;
  }

  // 6. Ledger: the old app granted each year's full quota (no pro-rating) plus the recorded carry-forward.
  const ledger = (entry: Parameters<typeof postLedger>[1]) => {
    postLedger(db, entry);
    report.ledgerEntries += 1;
  };
  const years = new Set<number>();
  for (const user of source.users) {
    const employeeId = map.get(user.id)!.employeeId;
    if (employeeId === null) continue;
    for (const year of legacyYearsFor(source, user)) {
      years.add(year);
      const policy = legacyPolicy(source, year);
      const base = { employeeId, year, date: `${year}-01-01`, refType: "legacy", note: NOTE };
      if (policy.casualPerYear) ledger({ ...base, leaveTypeId: CL, delta: policy.casualPerYear, kind: "grant" });
      if (policy.sickPerYear) ledger({ ...base, leaveTypeId: SL, delta: policy.sickPerYear, kind: "grant" });
      const carry = source.balances.find((b) => b.userId === user.id && b.year === year)?.carryForwardCl ?? 0;
      if (carry) ledger({ ...base, leaveTypeId: CL, delta: carry, kind: "carry_forward" });
    }
  }
  report.years = [...years].sort((a, b) => a - b);

  // 7. Leaves: planned and taken leave become approved requests with their recorded days.
  const typeFor = { casual: CL, sick: SL, unpaid: LWP } as const;
  for (const leave of source.leaves) {
    const ids = map.get(leave.userId);
    if (!ids?.employeeId) continue;
    const approved = leave.status !== "cancelled";
    const half = halvesFor(leave);
    const request = db
      .insert(leaveRequests)
      .values({
        employeeId: ids.employeeId,
        leaveTypeId: typeFor[leave.type] ?? LWP,
        startDate: leave.startDate,
        endDate: leave.endDate,
        startHalf: half,
        endHalf: half,
        days: leave.days,
        reason: leave.reason,
        status: approved ? "approved" : "cancelled",
        decidedAt: legacyTimestamp(leave.updatedAt),
        appliedBy: ids.userId,
        cancelledAt: approved ? null : legacyTimestamp(leave.updatedAt),
        cancelNote: approved ? null : NOTE,
        createdAt: legacyTimestamp(leave.createdAt),
        updatedAt: legacyTimestamp(leave.updatedAt),
      })
      .returning()
      .get();
    if (approved) {
      ledger({
        employeeId: ids.employeeId,
        leaveTypeId: request.leaveTypeId,
        year: Number(leave.startDate.slice(0, 4)),
        date: leave.startDate,
        delta: -leave.days,
        kind: "taken",
        refType: "leave_request",
        refId: request.id,
      });
      report.leaveRequests.approved += 1;
    } else {
      report.leaveRequests.cancelled += 1;
    }
  }
  return { report, map };
}
