import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { compOffConsumptions, compOffLots, leaveLedger, type EmployeeRow, type LeaveTypeRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { compOffAvailable, grantCompOff } from "@/server/modules/compoff/service";
import { applyLeave, applyLeaveOnBehalf, approveLeave, cancelLeave } from "@/server/modules/leave/requests";
import { compOffType, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const TODAY = "2026-11-10";
let db: DB;
let co: LeaveTypeRow;
let hr: SessionUser;
type Person = { employee: EmployeeRow; user: SessionUser };
let ravi: Person, asha: Person;

function person(name: string, overrides: Partial<EmployeeRow> = {}): Person {
  const login = insertUser(db, { name });
  const employee = insertEmployee(db, { firstName: name, dateOfJoining: "2025-01-01", userId: login.id, ...overrides });
  return { employee, user: sessionUserFor(db, login) };
}
const range = (startDate: string, endDate: string, startHalf: "full" | "second_half" = "full", endHalf: "full" | "first_half" = "full") => ({
  leaveTypeId: co.id, startDate, endDate, startHalf, endHalf, reason: null,
});
const lots = () => db.select({ remaining: compOffLots.remaining, status: compOffLots.status }).from(compOffLots).orderBy(asc(compOffLots.id)).all();

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  seedDefaultLeaveTypes(db);
  co = compOffType(db)!;
  hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
  ravi = person("Ravi");
  asha = person("Asha", { reportingManagerId: ravi.employee.id });
  ravi = { ...ravi, user: sessionUserFor(db, getUserById(db, ravi.user.id)!) };
  // Expires 11-20 (earned 08-22) and 12-01 (earned 09-02); the default expiry is 90 days.
  grantCompOff(db, hr.id, { employeeId: asha.employee.id, days: 1, earnedOn: "2026-08-22", note: "Weekend release" }, { today: TODAY });
  grantCompOff(db, hr.id, { employeeId: asha.employee.id, days: 1, earnedOn: "2026-09-02", note: "Holiday on-call" }, { today: TODAY });
});

describe("comp-off leave", () => {
  it("checks the lots valid on the leave date, not the ledger", () => {
    expect(compOffAvailable(db, asha.employee.id, "2026-11-16")).toBe(2);
    expect(compOffAvailable(db, asha.employee.id, "2026-11-23")).toBe(1);
    expectDomainError(
      () => applyLeave(db, asha.user, range("2026-11-23", "2026-11-24"), { today: TODAY, attachmentFileId: null }),
      "INSUFFICIENT_BALANCE",
    );
    const pending = applyLeave(db, asha.user, range("2026-11-16", "2026-11-16"), { today: TODAY, attachmentFileId: null });
    expect(pending.days).toBe(1);
    expectDomainError(
      () => applyLeave(db, asha.user, range("2026-11-17", "2026-11-18"), { today: TODAY, attachmentFileId: null }),
      "INSUFFICIENT_BALANCE",
    );
  });

  it("consumes the earliest-expiring lots first and gives them back on cancel", () => {
    const request = applyLeave(db, asha.user, range("2026-11-16", "2026-11-17", "full", "first_half"), { today: TODAY, attachmentFileId: null });
    expect(request.days).toBe(1.5);
    approveLeave(db, ravi.user, request.id, null);
    expect(lots()).toEqual([
      { remaining: 0, status: "consumed" },
      { remaining: 0.5, status: "active" },
    ]);
    expect(db.select({ days: compOffConsumptions.days }).from(compOffConsumptions).all()).toEqual([{ days: 1 }, { days: 0.5 }]);

    cancelLeave(db, asha.user, request.id, null, { today: TODAY });
    expect(lots()).toEqual([
      { remaining: 1, status: "active" },
      { remaining: 1, status: "active" },
    ]);
    expect(db.select().from(compOffConsumptions).all()).toEqual([]);
  });

  it("lapses restored days at once when their lot has expired meanwhile", () => {
    const request = applyLeaveOnBehalf(db, hr, { ...range("2026-11-16", "2026-11-16"), employeeId: asha.employee.id }, { today: TODAY, attachmentFileId: null });
    expect(lots()[0]).toEqual({ remaining: 0, status: "consumed" });
    cancelLeave(db, hr, request.id, "Worked that day", { today: "2026-11-25" });
    expect(lots()).toEqual([
      { remaining: 0, status: "expired" },
      { remaining: 1, status: "active" },
    ]);
    const lapse = db.select().from(leaveLedger).where(eq(leaveLedger.kind, "comp_off_lapse")).get();
    expect(lapse).toMatchObject({ delta: -1, year: 2026, refType: "comp_off_lot" });
  });

  it("re-checks the lots at approval", () => {
    const request = applyLeave(db, asha.user, range("2026-11-16", "2026-11-16"), { today: TODAY, attachmentFileId: null });
    db.update(compOffLots).set({ remaining: 0, status: "expired" }).run();
    expectDomainError(() => approveLeave(db, ravi.user, request.id, null), "INSUFFICIENT_BALANCE");
  });
});
