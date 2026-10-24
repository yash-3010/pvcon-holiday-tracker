import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { todayInTimeZone } from "@/lib/dates";
import { leaveYearOf } from "@/lib/leave";
import type { DB } from "@/server/db/client";
import { leaveLedger, leaveRequests, type LeaveTypeRow } from "@/server/db/schema";
import { createEmployee } from "@/server/modules/employees/service";
import {
  adjustBalance, balanceOf, balancesFor, closeLeaveYear, pendingDays, postLedger, syncEntitlements,
} from "@/server/modules/leave/ledger";
import { createLeaveType, listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { patchSetting } from "@/server/modules/settings/service";
import { createTestDb } from "../helpers/db";
import { employeeInput, insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

let db: DB;
let types: Record<string, LeaveTypeRow>;

beforeEach(() => {
  db = createTestDb();
  seedDefaultLeaveTypes(db);
  types = Object.fromEntries(listLeaveTypes(db).map((t) => [t.code, t]));
});

const rows = (employeeId: number, leaveTypeId: number) =>
  db
    .select({ year: leaveLedger.year, date: leaveLedger.date, delta: leaveLedger.delta, kind: leaveLedger.kind })
    .from(leaveLedger)
    .where(and(eq(leaveLedger.employeeId, employeeId), eq(leaveLedger.leaveTypeId, leaveTypeId)))
    .orderBy(leaveLedger.id)
    .all();

function earned(quota = 10) {
  return createLeaveType(db, {
    code: "EL", name: "Earned", color: "#16a34a", paid: true, isLop: false, accrual: "monthly", annualQuota: quota,
    carryForwardMax: 0, encashable: false, allowHalfDay: true, allowNegative: false, maxConsecutiveDays: null,
    minNoticeDays: 0, attachmentAfterDays: null, countWeekends: false, applicableEmploymentTypes: null,
  });
}

describe("upfront grants", () => {
  it("grants the full quota once to someone employed all year", () => {
    const e = insertEmployee(db, { dateOfJoining: "2024-05-01" });
    expect(syncEntitlements(db, e.id, "2026-03-10")).toEqual({ granted: 2, accrued: 0 });
    expect(syncEntitlements(db, e.id, "2026-07-01")).toEqual({ granted: 0, accrued: 0 });
    expect(rows(e.id, types.CL.id)).toEqual([{ year: 2026, date: "2026-01-01", delta: 12, kind: "grant" }]);
    expect(balanceOf(db, e.id, types.SL.id, 2026)).toBe(6);
    expect(rows(e.id, types.LWP.id)).toEqual([]);
    expect(rows(e.id, types.CO.id)).toEqual([]);
  });

  it("pro-rates for an October joiner from the joining date", () => {
    const e = insertEmployee(db, { dateOfJoining: "2026-10-15" });
    syncEntitlements(db, e.id, "2026-10-15");
    expect(rows(e.id, types.CL.id)).toEqual([{ year: 2026, date: "2026-10-15", delta: 3, kind: "grant" }]);
    expect(balanceOf(db, e.id, types.SL.id, 2026)).toBe(1.5);
  });

  it("follows a leave year that starts in April", () => {
    patchSetting(db, "leave", { yearStartMonth: 4 }, null);
    const e = insertEmployee(db, { dateOfJoining: "2026-10-01" });
    syncEntitlements(db, e.id, "2027-02-01");
    // October is month 7 of the April 2026 leave year: 12 × 6 / 12.
    expect(rows(e.id, types.CL.id)).toEqual([{ year: 2026, date: "2026-10-01", delta: 6, kind: "grant" }]);
  });

  it("skips exited employees, archived and inapplicable types, and future leave years", () => {
    const exited = insertEmployee(db, { status: "exited" });
    expect(syncEntitlements(db, exited.id, "2026-03-01")).toEqual({ granted: 0, accrued: 0 });
    const intern = insertEmployee(db, { employmentType: "intern", dateOfJoining: "2026-01-01" });
    createLeaveType(db, {
      code: "FT", name: "Full-time only", color: "#000000", paid: true, isLop: false, accrual: "upfront", annualQuota: 2,
      carryForwardMax: 0, encashable: false, allowHalfDay: true, allowNegative: false, maxConsecutiveDays: null,
      minNoticeDays: 0, attachmentAfterDays: null, countWeekends: false, applicableEmploymentTypes: ["full_time"],
    });
    expect(syncEntitlements(db, intern.id, "2026-03-01")).toEqual({ granted: 2, accrued: 0 });
    const future = insertEmployee(db, { dateOfJoining: "2027-02-01" });
    expect(syncEntitlements(db, future.id, "2026-12-01")).toEqual({ granted: 0, accrued: 0 });
  });
});

describe("monthly accrual", () => {
  it("accrues each elapsed month once, in half days", () => {
    const el = earned(10);
    const e = insertEmployee(db, { dateOfJoining: "2025-01-01" });
    expect(syncEntitlements(db, e.id, "2026-03-01").accrued).toBe(3);
    expect(syncEntitlements(db, e.id, "2026-03-20").accrued).toBe(0);
    expect(rows(e.id, el.id)).toEqual([
      { year: 2026, date: "2026-01-01", delta: 0.5, kind: "accrual" },
      { year: 2026, date: "2026-02-01", delta: 1, kind: "accrual" },
      { year: 2026, date: "2026-03-01", delta: 1, kind: "accrual" },
    ]);
  });

  it("starts with the joining month", () => {
    const el = earned(12);
    const e = insertEmployee(db, { dateOfJoining: "2026-03-10" });
    syncEntitlements(db, e.id, "2026-04-01");
    expect(rows(e.id, el.id).map((r) => r.date)).toEqual(["2026-03-01", "2026-04-01"]);
  });
});

describe("closing a leave year", () => {
  it("carries forward up to the cap and lapses the rest, once", () => {
    const e = insertEmployee(db, { dateOfJoining: "2024-01-01" });
    syncEntitlements(db, e.id, "2026-01-01");
    postLedger(db, { employeeId: e.id, leaveTypeId: types.CL.id, year: 2026, date: "2026-05-04", delta: -4, kind: "taken" });
    expect(closeLeaveYear(db, e.id, 2026)).toEqual({ carried: 6, lapsed: 2 + 6 });
    expect(closeLeaveYear(db, e.id, 2026)).toEqual({ carried: 0, lapsed: 0 });
    expect(rows(e.id, types.CL.id).slice(-3)).toEqual([
      { year: 2026, date: "2026-12-31", delta: -6, kind: "carry_forward" },
      { year: 2027, date: "2027-01-01", delta: 6, kind: "carry_forward" },
      { year: 2026, date: "2026-12-31", delta: -2, kind: "lapse" },
    ]);
    expect(balanceOf(db, e.id, types.CL.id, 2026)).toBe(0);
    expect(balanceOf(db, e.id, types.CL.id, 2027)).toBe(6);
    expect(balancesFor(db, e.id, 2026).find((b) => b.type.code === "CL")).toMatchObject({ credited: 12, used: 4, closed: 8, balance: 0 });
    expect(balancesFor(db, e.id, 2027).find((b) => b.type.code === "CL")).toMatchObject({ opening: 6, closed: 0, balance: 6 });
    expect(balanceOf(db, e.id, types.SL.id, 2026)).toBe(0);
    expect(balanceOf(db, e.id, types.SL.id, 2027)).toBe(0);
  });

  it("leaves negative balances alone", () => {
    const e = insertEmployee(db);
    postLedger(db, { employeeId: e.id, leaveTypeId: types.LWP.id, year: 2026, date: "2026-05-04", delta: -2, kind: "taken" });
    expect(closeLeaveYear(db, e.id, 2026)).toEqual({ carried: 0, lapsed: 0 });
    expect(balanceOf(db, e.id, types.LWP.id, 2026)).toBe(-2);
  });

  it("lapses comp-off that no active lot holds any more", () => {
    const e = insertEmployee(db);
    postLedger(db, { employeeId: e.id, leaveTypeId: types.CO.id, year: 2026, date: "2026-05-04", delta: 1, kind: "comp_off_credit" });
    expect(closeLeaveYear(db, e.id, 2026)).toEqual({ carried: 0, lapsed: 1 });
    expect(balanceOf(db, e.id, types.CO.id, 2027)).toBe(0);
  });
});

describe("balances", () => {
  it("splits a year into opening, credits, use, adjustments, lapses and pending", () => {
    const user = insertUser(db, { roles: ["hr_admin"] });
    const e = insertEmployee(db, { dateOfJoining: "2024-01-01" });
    postLedger(db, { employeeId: e.id, leaveTypeId: types.CL.id, year: 2026, date: "2026-01-01", delta: 3, kind: "carry_forward" });
    syncEntitlements(db, e.id, "2026-01-01");
    postLedger(db, { employeeId: e.id, leaveTypeId: types.CL.id, year: 2026, date: "2026-02-02", delta: -2, kind: "taken" });
    postLedger(db, { employeeId: e.id, leaveTypeId: types.CL.id, year: 2026, date: "2026-02-03", delta: 1, kind: "cancelled" });
    adjustBalance(db, user.id, { employeeId: e.id, leaveTypeId: types.CL.id, year: 2026, delta: -0.5, note: "Correction" }, "2027-01-10");
    db.insert(leaveRequests)
      .values({ employeeId: e.id, leaveTypeId: types.CL.id, startDate: "2026-06-01", endDate: "2026-06-02", days: 2 })
      .run();
    db.insert(leaveRequests)
      .values({ employeeId: e.id, leaveTypeId: types.CL.id, startDate: "2027-01-04", endDate: "2027-01-04", days: 1 })
      .run();

    expect(pendingDays(db, e.id, types.CL.id, 2026)).toBe(2);
    const cl = balancesFor(db, e.id, 2026).find((b) => b.type.code === "CL")!;
    expect(cl).toMatchObject({ opening: 3, credited: 12, used: 1, adjusted: -0.5, closed: 0, balance: 13.5, pending: 2, available: 11.5 });
    expect(balancesFor(db, e.id, 2026).map((b) => b.type.code)).toEqual(["CL", "SL", "LWP", "CO"]);
    const adjustment = db.select().from(leaveLedger).where(eq(leaveLedger.kind, "adjustment")).get();
    expect(adjustment).toMatchObject({ note: "Correction", createdBy: user.id, date: "2026-12-31" });
  });
});

describe("employee creation", () => {
  it("grants the current year's entitlements", () => {
    const hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
    const e = createEmployee(db, hr, employeeInput({ dateOfJoining: "2020-01-01" }), { login: { mode: "none" }, onboarding: false });
    const year = leaveYearOf(todayInTimeZone("Asia/Kolkata"), 1);
    expect(balanceOf(db, e.id, types.CL.id, year)).toBe(12);
  });
});
