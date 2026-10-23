import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import {
  attendanceDays, employees, holidayYearConfig, leaveLedger, leaveRequests, leaveTypes, userRoles, users,
} from "@/server/db/schema";
import { legacyBalance, readLegacy, type LegacySource } from "@/server/modules/legacy/source";
import { migrateLegacy } from "@/server/modules/legacy/migrate";
import { runLegacyMigration } from "@/server/modules/legacy/run";
import { verifyMigration } from "@/server/modules/legacy/verify";
import { balanceOf } from "@/server/modules/leave/ledger";
import { getUserById, verifyCredentials } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { expectDomainError } from "../helpers/fixtures";

const PASSWORD = "Legacy@Pass1";
const HASH = bcrypt.hashSync(PASSWORD, 4);

/** The old Holiday Tracker schema (`git show 489c251:src/db/migrations/0000_init.sql`) with a small, awkward dataset. */
function buildLegacy(sqlite: Database.Database): void {
  sqlite.exec(readFileSync("tests/fixtures/legacy-holiday-tracker.sql", "utf8"));
  const user = sqlite.prepare(
    "insert into users (id, name, email, password_hash, role, joined_date, must_change_password, active, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  user.run(1, "System Admin", "Admin@PVCON.in", HASH, "admin", "2024-01-01", 0, 1, "2024-01-01 09:00:00");
  user.run(2, "Asha Rao", "asha@pvcon.in", HASH, "employee", "2025-03-10", 0, 1, "2025-03-10 09:00:00");
  user.run(3, "Ravi Kumar Menon", "ravi@pvcon.in", HASH, "employee", "2024-06-01", 1, 1, "2024-06-01 09:00:00");
  user.run(4, "Old Timer", "old@pvcon.in", HASH, "employee", "2024-01-01", 0, 0, "2024-01-01 09:00:00");
  user.run(5, "Hema", "hema@pvcon.in", HASH, "admin", "2024-01-01", 0, 1, "2024-01-01 09:00:00");

  const policy = sqlite.prepare("insert into leave_policy values (?, ?, ?, ?, ?, ?)");
  policy.run(2025, 12, 6, 6, 3, 2);
  policy.run(2026, 10, 5, 4, 2, 3);
  const balance = sqlite.prepare("insert into user_year_balance values (?, ?, ?)");
  balance.run(2, 2026, 3.5);
  balance.run(3, 2026, 0);

  const holiday = sqlite.prepare("insert into holidays (id, year, date, name, type) values (?, ?, ?, ?, ?)");
  holiday.run(1, 2025, "2025-01-26", "Republic Day", "fixed");
  holiday.run(2, 2025, "2025-10-20", "Diwali", "optional");
  holiday.run(3, 2026, "2026-01-26", "Republic Day", "fixed");
  holiday.run(4, 2026, "2026-03-04", "Holi", "optional");
  holiday.run(5, 2026, "2026-11-08", "Diwali", "optional");
  holiday.run(6, 2027, "2027-01-26", "Republic Day", "fixed");
  const pick = sqlite.prepare("insert into holiday_selections (user_id, holiday_id) values (?, ?)");
  for (const [u, h] of [[2, 4], [2, 5], [3, 2], [1, 4], [5, 4]]) pick.run(u, h);

  const leave = sqlite.prepare(
    "insert into leaves (user_id, start_date, end_date, days, type, reason, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  leave.run(2, "2025-04-01", "2025-04-02", 2, "casual", "Trip", "taken", "2025-03-20 10:00:00", "2025-04-03T05:00:00.000Z");
  leave.run(2, "2025-05-05", "2025-05-05", 0.5, "sick", null, "taken", "2025-05-05 08:00:00", "2025-05-05 08:00:00");
  leave.run(2, "2026-02-02", "2026-02-03", 2, "casual", null, "planned", "2026-01-10 08:00:00", "2026-01-10 08:00:00");
  leave.run(2, "2026-03-10", "2026-03-11", 1.25, "casual", null, "taken", "2026-03-01 08:00:00", "2026-03-01 08:00:00");
  leave.run(2, "2026-04-01", "2026-04-01", 1, "unpaid", null, "taken", "2026-03-25 08:00:00", "2026-03-25 08:00:00");
  leave.run(2, "2026-06-01", "2026-06-01", 1, "casual", null, "cancelled", "2026-05-20 08:00:00", "2026-05-22 08:00:00");
  leave.run(3, "2025-12-30", "2026-01-02", 3, "casual", null, "taken", "2025-12-01 08:00:00", "2025-12-01 08:00:00");
  leave.run(3, "2026-07-01", "2026-07-02", 2, "sick", null, "planned", "2026-06-25 08:00:00", "2026-06-25 08:00:00");
  leave.run(4, "2024-05-01", "2024-05-01", 1, "casual", null, "taken", "2024-04-20 08:00:00", "2024-04-20 08:00:00");
  leave.run(5, "2026-08-10", "2026-08-10", 1, "casual", null, "taken", "2026-08-01 08:00:00", "2026-08-01 08:00:00");
}

let legacy: Database.Database;
let source: LegacySource;
let db: DB;

beforeEach(() => {
  legacy = new Database(":memory:");
  buildLegacy(legacy);
  source = readLegacy(legacy);
  db = createTestDb();
});

afterEach(() => legacy.close());

const employeeByEmail = (email: string) => db.select().from(employees).where(eq(employees.workEmail, email)).get();
const type = (code: string) => db.select().from(leaveTypes).where(eq(leaveTypes.code, code)).get()!;

describe("reading the old database", () => {
  it("re-implements the old balance calculation", () => {
    expect(legacyBalance(source, 2, 2026)).toEqual({ casualBalance: 10 + 3.5 - 2 - 1.25, sickBalance: 5, unpaidUsed: 1, optionalUsed: 2 });
    expect(legacyBalance(source, 4, 2024)).toEqual({ casualBalance: 11, sickBalance: 6, unpaidUsed: 0, optionalUsed: 0 });
  });

  it("refuses a database that is not a Holiday Tracker database", () => {
    const other = new Database(":memory:");
    expectDomainError(() => readLegacy(other), "NOT_LEGACY");
    other.close();
  });
});

describe("migrateLegacy", () => {
  it("moves people, holidays, picks and leave, and reports what it did", () => {
    const { report } = migrateLegacy(source, db);
    expect(report).toEqual({
      users: 5,
      superAdmins: 2,
      employees: 4,
      exitedEmployees: 1,
      adminsWithEmployeeRecord: ["hema@pvcon.in"],
      holidays: 6,
      optionalSelections: 4,
      droppedSelections: 1,
      leaveRequests: { approved: 9, cancelled: 1 },
      ledgerEntries: expect.any(Number),
      years: [2024, 2025, 2026],
      attendanceDays: expect.any(Number),
    });
  });

  it("computes attendance for the history in auto mode, so it reads present rather than absent", () => {
    // 1 July 2026, 11:30 IST.
    const { report } = migrateLegacy(source, db, { now: new Date("2026-07-01T06:00:00Z") });
    const day = (email: string, date: string) =>
      db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeByEmail(email)!.id), eq(attendanceDays.date, date))).get();
    expect(day("asha@pvcon.in", "2025-03-09")).toBeUndefined();
    expect(day("asha@pvcon.in", "2025-03-10")).toMatchObject({ status: "present", workedMinutes: 0 });
    expect(day("asha@pvcon.in", "2025-04-01")).toMatchObject({ status: "on_leave" });
    expect(day("asha@pvcon.in", "2025-04-05")).toMatchObject({ status: "weekly_off" });
    expect(day("ravi@pvcon.in", "2026-01-26")).toMatchObject({ status: "holiday" });
    expect(day("ravi@pvcon.in", "2026-07-02")).toBeUndefined();
    // An inactive account has no known last working day, so it gets no attendance.
    expect(db.select().from(attendanceDays).where(eq(attendanceDays.employeeId, employeeByEmail("old@pvcon.in")!.id)).all()).toEqual([]);
    expect(report.attendanceDays).toBe(db.select().from(attendanceDays).all().length);
  });

  it("turns admins into super admins and employees into numbered employee records", () => {
    migrateLegacy(source, db);
    const admin = db.select().from(users).where(eq(users.email, "admin@pvcon.in")).get()!;
    expect(db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, admin.id)).all()).toEqual([{ role: "super_admin" }]);
    expect(db.select().from(employees).where(eq(employees.userId, admin.id)).get()).toBeUndefined();

    expect(db.select({ code: employees.employeeCode, email: employees.workEmail }).from(employees).orderBy(employees.id).all()).toEqual([
      { code: "PV0001", email: "asha@pvcon.in" },
      { code: "PV0002", email: "ravi@pvcon.in" },
      { code: "PV0003", email: "old@pvcon.in" },
      { code: "PV0004", email: "hema@pvcon.in" },
    ]);
    expect(employeeByEmail("ravi@pvcon.in")).toMatchObject({ firstName: "Ravi", lastName: "Kumar Menon", displayName: "Ravi Kumar Menon", dateOfJoining: "2024-06-01" });
    const ravi = getUserById(db, employeeByEmail("ravi@pvcon.in")!.userId!)!;
    expect(ravi).toMatchObject({ name: "Ravi Kumar Menon", mustChangePassword: true, status: "active" });

    const old = employeeByEmail("old@pvcon.in")!;
    expect(old).toMatchObject({ status: "exited", exitReason: "Migrated inactive account" });
    expect(getUserById(db, old.userId!)!.status).toBe("disabled");
    const hema = getUserById(db, employeeByEmail("hema@pvcon.in")!.userId!)!;
    expect(db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, hema.id)).all().map((r) => r.role).sort()).toEqual(["employee", "super_admin"]);
  });

  it("keeps the old passwords working", async () => {
    migrateLegacy(source, db);
    const result = await verifyCredentials(db, "asha@pvcon.in", PASSWORD, { now: new Date(), lockoutAttempts: 5, lockoutMinutes: 15, cost: 4 });
    expect(result.ok).toBe(true);
  });

  it("configures leave types and optional allowances from the old policy", () => {
    migrateLegacy(source, db);
    expect(type("CL")).toMatchObject({ annualQuota: 10, carryForwardMax: 4, maxConsecutiveDays: 2 });
    expect(type("SL")).toMatchObject({ annualQuota: 5 });
    expect(db.select().from(holidayYearConfig).orderBy(holidayYearConfig.year).all().map((r) => [r.year, r.optionalAllowed])).toEqual([
      [2025, 2], [2026, 3], [2027, 6],
    ]);
  });

  it("produces the same balances as the old app", () => {
    migrateLegacy(source, db);
    const asha = employeeByEmail("asha@pvcon.in")!.id;
    expect(balanceOf(db, asha, type("CL").id, 2026)).toBe(10.25);
    expect(balanceOf(db, asha, type("CL").id, 2025)).toBe(10);
    expect(balanceOf(db, asha, type("SL").id, 2025)).toBe(5.5);
    expect(balanceOf(db, asha, type("LWP").id, 2026)).toBe(-1);
    const ravi = employeeByEmail("ravi@pvcon.in")!.id;
    expect(balanceOf(db, ravi, type("CL").id, 2025)).toBe(9);
    expect(balanceOf(db, ravi, type("SL").id, 2026)).toBe(3);
    expect(balanceOf(db, employeeByEmail("old@pvcon.in")!.id, type("CL").id, 2024)).toBe(11);
  });

  it("migrates leave requests with their days, halves and timestamps", () => {
    migrateLegacy(source, db);
    const asha = employeeByEmail("asha@pvcon.in")!.id;
    const rows = db.select().from(leaveRequests).where(eq(leaveRequests.employeeId, asha)).orderBy(leaveRequests.id).all();
    expect(rows.map((r) => [r.startDate, r.days, r.status, r.startHalf])).toEqual([
      ["2025-04-01", 2, "approved", "full"],
      ["2025-05-05", 0.5, "approved", "first_half"],
      ["2026-02-02", 2, "approved", "full"],
      ["2026-03-10", 1.25, "approved", "full"],
      ["2026-04-01", 1, "approved", "full"],
      ["2026-06-01", 1, "cancelled", "full"],
    ]);
    expect(rows[0]).toMatchObject({ reason: "Trip", createdAt: "2025-03-20T10:00:00.000Z", decidedAt: "2025-04-03T05:00:00.000Z" });
    const cancelledLedger = db.select().from(leaveLedger).where(and(eq(leaveLedger.refType, "leave_request"), eq(leaveLedger.refId, rows[5]!.id))).all();
    expect(cancelledLedger).toEqual([]);
  });
});

describe("verifyMigration", () => {
  it("finds no differences after a clean migration", () => {
    const { map } = migrateLegacy(source, db);
    expect(verifyMigration(source, db, map)).toEqual([]);
  });

  it("reports a tampered balance", () => {
    const { map } = migrateLegacy(source, db);
    const grant = db.select().from(leaveLedger).where(eq(leaveLedger.kind, "grant")).get()!;
    db.update(leaveLedger).set({ delta: grant.delta - 1 }).where(eq(leaveLedger.id, grant.id)).run();
    const mismatches = verifyMigration(source, db, map);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({ email: "asha@pvcon.in", year: 2025, field: "casualBalance", legacy: 10, migrated: 9 });
  });
});

describe("runLegacyMigration", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pvcon-legacy-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("builds a new database file, verifies it and never touches the old file", () => {
    const from = join(dir, "app.db");
    const to = join(dir, "people.db");
    const file = new Database(from);
    buildLegacy(file);
    file.close();
    const sha = () => createHash("sha256").update(readFileSync(from)).digest("hex");
    const before = sha();

    const result = runLegacyMigration({ from, to });
    expect(result.mismatches).toEqual([]);
    expect(result.report.employees).toBe(4);
    expect(sha()).toBe(before);
    expectDomainError(() => runLegacyMigration({ from, to }), "TARGET_EXISTS");
    expectDomainError(() => runLegacyMigration({ from: join(dir, "missing.db"), to: join(dir, "x.db") }), "SOURCE_MISSING");
    expectDomainError(() => runLegacyMigration({ from: to, to: join(dir, "y.db") }), "NOT_LEGACY");
  });
});
