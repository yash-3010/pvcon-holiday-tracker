import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { attendancePunches, compOffLots, leaveLedger, notifications, type EmployeeRow } from "@/server/db/schema";
import { recomputeAttendance } from "@/server/modules/attendance/compute";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import {
  approveCompOffClaim, compOffAvailable, eligibleOffDays, grantCompOff, rejectCompOffClaim, submitCompOffClaim, withdrawCompOffClaim,
} from "@/server/modules/compoff/service";
import { balanceOf } from "@/server/modules/leave/ledger";
import { compOffType, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { patchSetting } from "@/server/modules/settings/service";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

// Tuesday 10 Nov 2026.
const TODAY = "2026-11-10";
const NOW = new Date("2026-11-10T06:00:00Z");
let db: DB;
type Person = { employee: EmployeeRow; user: SessionUser };
let ravi: Person, asha: Person;

function person(name: string, overrides: Partial<EmployeeRow> = {}): Person {
  const login = insertUser(db, { name });
  const employee = insertEmployee(db, { firstName: name, dateOfJoining: "2025-01-01", userId: login.id, ...overrides });
  return { employee, user: sessionUserFor(db, login) };
}

/** Local times in IST on `date`: e.g. worked("2026-11-07", "04:30", "13:00") is 10:00–18:30. */
function worked(employeeId: number, date: string, inUtc: string, outUtc: string) {
  db.insert(attendancePunches).values({ employeeId, at: `${date}T${inUtc}:00.000Z`, date, direction: "in" }).run();
  db.insert(attendancePunches).values({ employeeId, at: `${date}T${outUtc}:00.000Z`, date, direction: "out" }).run();
  recomputeAttendance(db, employeeId, date, date, { now: NOW });
}

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  seedDefaultLeaveTypes(db);
  ravi = person("Ravi");
  asha = person("Asha", { reportingManagerId: ravi.employee.id });
  ravi = { ...ravi, user: sessionUserFor(db, getUserById(db, ravi.user.id)!) };
  worked(asha.employee.id, "2026-11-07", "04:30", "13:00"); // Saturday, 8h30
  worked(asha.employee.id, "2026-11-08", "04:30", "09:30"); // Sunday, 5h
  worked(asha.employee.id, "2026-11-01", "04:30", "07:30"); // Sunday, 3h
  worked(asha.employee.id, "2026-11-09", "04:00", "13:00"); // Monday, a normal working day
});

describe("eligibility", () => {
  it("offers off days worked long enough, inside the claim window", () => {
    expect(eligibleOffDays(db, asha.employee.id, { today: TODAY })).toEqual([
      { date: "2026-11-07", workedMinutes: 510, days: 1 },
      { date: "2026-11-08", workedMinutes: 300, days: 0.5 },
    ]);
    patchSetting(db, "compOff", { claimWindowDays: 2 }, null);
    expect(eligibleOffDays(db, asha.employee.id, { today: TODAY }).map((d) => d.date)).toEqual(["2026-11-08"]);
  });
});

describe("claims", () => {
  it("snapshots the work and tells the manager", () => {
    const claim = submitCompOffClaim(db, asha.user, { workedDate: "2026-11-07", reason: "Release" }, { today: TODAY });
    expect(claim).toMatchObject({ status: "pending", workedMinutes: 510, daysRequested: 1, reason: "Release" });
    expect(db.select({ userId: notifications.userId, type: notifications.type }).from(notifications).all()).toEqual([
      { userId: ravi.user.id, type: "compoff.submitted" },
    ]);
    expect(eligibleOffDays(db, asha.employee.id, { today: TODAY }).map((d) => d.date)).toEqual(["2026-11-08"]);
  });

  it("refuses what isn't claimable", () => {
    expectDomainError(() => submitCompOffClaim(db, asha.user, { workedDate: "2026-11-09", reason: null }, { today: TODAY }), "NOT_OFF_DAY_WORK");
    expectDomainError(() => submitCompOffClaim(db, asha.user, { workedDate: "2026-11-01", reason: null }, { today: TODAY }), "TOO_FEW_MINUTES");
    expectDomainError(() => submitCompOffClaim(db, asha.user, { workedDate: TODAY, reason: null }, { today: TODAY }), "FUTURE_DATE");
    submitCompOffClaim(db, asha.user, { workedDate: "2026-11-07", reason: null }, { today: TODAY });
    expectDomainError(() => submitCompOffClaim(db, asha.user, { workedDate: "2026-11-07", reason: null }, { today: TODAY }), "ALREADY_CLAIMED");
    expectDomainError(() => submitCompOffClaim(db, asha.user, { workedDate: "2026-11-08", reason: null }, { today: "2026-12-20" }), "OUTSIDE_WINDOW");
    patchSetting(db, "compOff", { enabled: false }, null);
    expectDomainError(() => submitCompOffClaim(db, asha.user, { workedDate: "2026-11-08", reason: null }, { today: TODAY }), "COMPOFF_DISABLED");
  });

  it("lets a rejected or withdrawn day be claimed again", () => {
    const first = submitCompOffClaim(db, asha.user, { workedDate: "2026-11-07", reason: null }, { today: TODAY });
    rejectCompOffClaim(db, ravi.user, first.id, "Not approved work");
    const second = submitCompOffClaim(db, asha.user, { workedDate: "2026-11-07", reason: "Was approved by email" }, { today: TODAY });
    expect(withdrawCompOffClaim(db, asha.user, second.id).status).toBe("withdrawn");
    expect(submitCompOffClaim(db, asha.user, { workedDate: "2026-11-07", reason: null }, { today: TODAY }).status).toBe("pending");
  });
});

describe("approval", () => {
  it("creates an expiring lot and a comp-off credit", () => {
    const claim = submitCompOffClaim(db, asha.user, { workedDate: "2026-11-07", reason: null }, { today: TODAY });
    expect(approveCompOffClaim(db, ravi.user, claim.id, { resolution: "leave", note: null, today: TODAY })).toMatchObject({
      status: "approved", resolution: "leave", approverId: ravi.user.id,
    });
    expect(db.select().from(compOffLots).get()).toMatchObject({ days: 1, remaining: 1, earnedOn: "2026-11-07", expiresOn: "2027-02-05", claimId: claim.id });
    const co = compOffType(db)!;
    expect(balanceOf(db, asha.employee.id, co.id, 2026)).toBe(1);
    expect(db.select().from(leaveLedger).where(eq(leaveLedger.kind, "comp_off_credit")).get()).toMatchObject({ refType: "comp_off_lot" });
    expect(compOffAvailable(db, asha.employee.id, "2027-02-05")).toBe(1);
    expect(compOffAvailable(db, asha.employee.id, "2027-02-06")).toBe(0);
  });

  it("pays out only when payout is enabled, without a lot", () => {
    const claim = submitCompOffClaim(db, asha.user, { workedDate: "2026-11-07", reason: null }, { today: TODAY });
    expectDomainError(() => approveCompOffClaim(db, ravi.user, claim.id, { resolution: "payout", note: null, today: TODAY }), "PAYOUT_DISABLED");
    patchSetting(db, "compOff", { payoutEnabled: true }, null);
    expect(approveCompOffClaim(db, ravi.user, claim.id, { resolution: "payout", note: null, today: TODAY }).resolution).toBe("payout");
    expect(db.select().from(compOffLots).all()).toEqual([]);
  });

  it("keeps decisions inside the reporting line", () => {
    const peer = person("Meera");
    const claim = submitCompOffClaim(db, asha.user, { workedDate: "2026-11-07", reason: null }, { today: TODAY });
    expectDomainError(() => approveCompOffClaim(db, peer.user, claim.id, { resolution: "leave", note: null, today: TODAY }), "FORBIDDEN");
    expectDomainError(() => approveCompOffClaim(db, asha.user, claim.id, { resolution: "leave", note: null, today: TODAY }), "SELF_APPROVAL");
  });
});

describe("manual grants", () => {
  it("adds a lot without a claim", () => {
    const hr = insertUser(db, { roles: ["hr_admin"] });
    const lot = grantCompOff(db, hr.id, { employeeId: asha.employee.id, days: 1.5, earnedOn: "2026-11-01", note: "Client visit" }, { today: TODAY });
    expect(lot).toMatchObject({ claimId: null, days: 1.5, remaining: 1.5, expiresOn: "2027-01-30", note: "Client visit", createdBy: hr.id });
    expect(compOffAvailable(db, asha.employee.id, TODAY)).toBe(1.5);
    expectDomainError(
      () => grantCompOff(db, hr.id, { employeeId: asha.employee.id, days: 1, earnedOn: "2026-07-01", note: "Too old" }, { today: TODAY }),
      "ALREADY_EXPIRED",
    );
  });
});
