import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { attendanceDays, compOffClaims, leaveRequests, leaveTypes, shifts, type EmployeeRow } from "@/server/db/schema";
import { setOverride } from "@/server/modules/attendance/overrides";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { postLedger } from "@/server/modules/leave/ledger";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { periodDays, periodVariables } from "@/server/modules/payroll/period";
import { patchSetting } from "@/server/modules/settings/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser } from "../helpers/fixtures";

let db: DB;
let asha: EmployeeRow;
let hrId: number;
// After November 2026 has ended.
const AFTER = { today: "2026-12-02", now: new Date("2026-12-02T06:00:00Z") };
const type = (code: string) => listLeaveTypes(db).find((t) => t.code === code)!;
function leave(code: string, date: string, half: "full" | "first_half" = "full") {
  db.insert(leaveRequests).values({
    employeeId: asha.id, leaveTypeId: type(code).id, startDate: date, endDate: date, startHalf: half, endHalf: half, days: half === "full" ? 1 : 0.5,
    status: "approved",
  }).run();
}

beforeEach(() => {
  db = createTestDb();
  // Auto mode: present unless something says otherwise, so the tests needn't write punches.
  seedDefaultShift(db, { attendanceMode: "auto" });
  seedDefaultLeaveTypes(db);
  hrId = insertUser(db, { roles: ["hr_admin"] }).id;
  asha = insertEmployee(db, { dateOfJoining: "2024-03-15" });
});

describe("period days", () => {
  it("charges absences and unpaid leave, on either basis", () => {
    for (const date of ["2026-11-03", "2026-11-04"]) setOverride(db, hrId, { employeeId: asha.id, date, status: "absent", note: "No show" }, AFTER);
    leave("LWP", "2026-11-10");
    leave("CL", "2026-11-11");
    const vars = periodVariables(db, asha, "2026-11", AFTER);
    expect(vars).toMatchObject({ TOTAL_DAYS: 30, WORKING_DAYS: 21, LOP_DAYS: 3, PAID_DAYS: 27, PRESENT_DAYS: 17 });
    patchSetting(db, "payroll", { prorationBasis: "working" }, null);
    expect(periodVariables(db, asha, "2026-11", AFTER)).toMatchObject({ TOTAL_DAYS: 21, LOP_DAYS: 3, PAID_DAYS: 18 });
  });

  it("keeps days already computed under earlier shift rules and computes only the missing ones", () => {
    expect(periodVariables(db, asha, "2026-11", AFTER)).toMatchObject({ LOP_DAYS: 0 });
    // Switching to punch mode later must not turn the month's earlier days into absences.
    db.update(shifts).set({ attendanceMode: "punch" }).run();
    db.delete(attendanceDays).where(and(eq(attendanceDays.employeeId, asha.id), eq(attendanceDays.date, "2026-11-30"))).run();
    expect(periodVariables(db, asha, "2026-11", AFTER)).toMatchObject({ LOP_DAYS: 1 });
    expect(periodDays(db, asha.id, "2026-11", AFTER).find((d) => d.date === "2026-11-30")).toMatchObject({ status: "absent" });
  });

  it("projects the rest of a month that hasn't ended as worked", () => {
    setOverride(db, hrId, { employeeId: asha.id, date: "2026-11-03", status: "absent", note: "No show" }, { now: new Date("2026-11-15T06:00:00Z") });
    leave("LWP", "2026-11-20");
    const days = periodDays(db, asha.id, "2026-11", { today: "2026-11-15", now: new Date("2026-11-15T06:00:00Z") });
    expect(days.find((d) => d.date === "2026-11-25")).toMatchObject({ status: "projected", working: true });
    expect(days.find((d) => d.date === "2026-11-20")).toMatchObject({ status: "on_leave", lopLeave: 1 });
    expect(periodVariables(db, asha, "2026-11", { today: "2026-11-15", now: new Date("2026-11-15T06:00:00Z") })).toMatchObject({
      LOP_DAYS: 2, PAID_DAYS: 28,
    });
  });

  it("counts service, unpaid comp-off payouts once, and encashable leave on leaving", () => {
    db.insert(compOffClaims).values({
      employeeId: asha.id, workedDate: "2026-11-07", workedMinutes: 480, daysRequested: 1, status: "approved", resolution: "payout",
      decidedAt: "2026-11-09T05:00:00.000Z",
    }).run();
    expect(periodVariables(db, asha, "2026-11", AFTER)).toMatchObject({ COMP_OFF_DAYS: 1, YEARS_OF_SERVICE: 2, MONTHS_OF_SERVICE: 32, ENCASH_DAYS: 0 });
    db.update(compOffClaims).set({ paidRunId: 1 }).run();
    expect(periodVariables(db, asha, "2026-11", AFTER).COMP_OFF_DAYS).toBe(0);

    db.update(leaveTypes).set({ encashable: true }).where(eq(leaveTypes.code, "CL")).run();
    postLedger(db, { employeeId: asha.id, leaveTypeId: type("CL").id, year: 2026, date: "2026-01-01", delta: 7.5, kind: "grant" });
    const leaving = { ...asha, lastWorkingDate: "2026-11-20" };
    expect(periodVariables(db, leaving, "2026-11", AFTER)).toMatchObject({ ENCASH_DAYS: 7.5 });
  });
});
