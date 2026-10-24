import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { expenseClaims, leaveRequests, payrollRuns, type EmployeeRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import {
  headcountTrend, joinersLeavers, leaveSnapshot, myPendingRequests, openExitsAndChecklists, payrollStatus, teamLeaveAhead, teamOutToday,
  upcomingCelebrations,
} from "@/server/modules/dashboard/queries";
import { syncEntitlements } from "@/server/modules/leave/ledger";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";

const TODAY = "2026-11-10";
let db: DB;
let boss: EmployeeRow, asha: EmployeeRow, kiran: EmployeeRow, intern: EmployeeRow, other: EmployeeRow;
const leave = (e: EmployeeRow, startDate: string, endDate = startDate, status: "approved" | "pending" = "approved") =>
  db.insert(leaveRequests).values({
    employeeId: e.id, leaveTypeId: listLeaveTypes(db).find((t) => t.code === "CL")!.id, startDate, endDate, startHalf: "full", endHalf: "full",
    days: 1, status,
  }).run();

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db, { attendanceMode: "auto" });
  seedDefaultLeaveTypes(db);
  boss = insertEmployee(db, { firstName: "Boss", dateOfJoining: "2020-11-12", dateOfBirth: "1980-11-20" });
  asha = insertEmployee(db, { firstName: "Asha", reportingManagerId: boss.id, dateOfJoining: "2026-11-02", dateOfBirth: "1992-02-29" });
  kiran = insertEmployee(db, { firstName: "Kiran", reportingManagerId: boss.id, dateOfJoining: "2025-06-01" });
  intern = insertEmployee(db, { firstName: "Intern", reportingManagerId: asha.id, dateOfJoining: "2026-06-01" });
  other = insertEmployee(db, { firstName: "Other", dateOfJoining: "2025-01-01", status: "on_notice", lastWorkingDate: "2026-11-30" });
  insertEmployee(db, { firstName: "Gone", dateOfJoining: "2024-01-01", status: "exited", lastWorkingDate: "2026-10-15" });
});

describe("employee widgets", () => {
  it("shows available leave without comp-off or unpaid types, and the employee's waiting requests", () => {
    syncEntitlements(db, kiran.id, TODAY);
    const snapshot = leaveSnapshot(db, kiran.id, TODAY);
    expect(snapshot.balances.map((b) => b.code)).toEqual(["CL", "SL"]);
    expect(snapshot.compOff).toEqual({ available: 0, nextExpiry: null });
    leave(kiran, "2026-11-20", "2026-11-20", "pending");
    db.insert(expenseClaims).values({ employeeId: kiran.id, category: "meals", claimDate: "2026-11-02", amount: 1, description: "Tea", status: "submitted" }).run();
    expect(myPendingRequests(db, kiran.id)).toEqual({ leave: 1, regularization: 0, compOff: 0, claims: 1, timesheets: 0 });
  });

  it("lists teammates away: the manager, peers and reports, not others", () => {
    for (const e of [boss, kiran, intern, other]) leave(e, TODAY);
    leave(asha, "2026-11-12");
    expect(teamOutToday(db, asha.id, TODAY).map((a) => a.name)).toEqual(["Boss Test", "Intern Test", "Kiran Test"]);
    expect(teamLeaveAhead(db, boss.id, TODAY, 7).map((a) => [a.name, a.startDate])).toEqual([["Intern Test", TODAY], ["Kiran Test", TODAY], ["Asha Test", "2026-11-12"]]);
  });
});

describe("HR widgets", () => {
  it("counts heads by month end, joiners, leavers, notice and payroll status", () => {
    expect(headcountTrend(db, TODAY, 3)).toEqual([
      { period: "2026-09", headcount: 5 }, { period: "2026-10", headcount: 4 }, { period: "2026-11", headcount: 5 },
    ]);
    expect(joinersLeavers(db, "2026-11").joiners.map((j) => j.name)).toEqual(["Asha Test"]);
    expect(joinersLeavers(db, "2026-10").leavers.map((j) => j.name)).toEqual(["Gone Test"]);
    expect(openExitsAndChecklists(db).exits.map((e) => e.name)).toEqual(["Other Test"]);
    db.insert(payrollRuns).values({ period: "2026-10", status: "released" }).run();
    expect(payrollStatus(db, TODAY).map((p) => [p.period, p.run?.status ?? null])).toEqual([["2026-10", "released"], ["2026-11", null]]);
  });

  it("finds birthdays and work anniversaries ahead, with a leap-day birthday on 28 February", () => {
    expect(upcomingCelebrations(db, TODAY, 14).map((c) => [c.name, c.kind, c.date, c.years])).toEqual([
      ["Boss Test", "anniversary", "2026-11-12", 6], ["Boss Test", "birthday", "2026-11-20", null],
    ]);
    expect(upcomingCelebrations(db, "2027-02-27", 3).map((c) => [c.name, c.date])).toEqual([["Asha Test", "2027-02-28"]]);
  });
});
