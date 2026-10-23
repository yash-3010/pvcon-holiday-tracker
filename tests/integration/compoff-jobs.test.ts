import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { compOffLots, leaveLedger, notifications, type EmployeeRow } from "@/server/db/schema";
import { runJobByName } from "@/server/jobs/registry";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { expireCompOff, grantCompOff } from "@/server/modules/compoff/service";
import { balanceOf } from "@/server/modules/leave/ledger";
import { compOffType, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser } from "../helpers/fixtures";

let db: DB;
let asha: EmployeeRow;
let hrId: number;

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  seedDefaultLeaveTypes(db);
  hrId = insertUser(db, { roles: ["hr_admin"] }).id;
  asha = insertEmployee(db, { dateOfJoining: "2025-01-01", userId: insertUser(db).id });
});

const grant = (earnedOn: string, today: string, days = 1) =>
  grantCompOff(db, hrId, { employeeId: asha.id, days, earnedOn, note: "Weekend work" }, { today });

describe("comp-off expiry", () => {
  it("lapses what is left of expired lots once, and warns a week ahead", () => {
    grant("2026-08-01", "2026-08-02"); // expires 2026-10-30
    grant("2026-08-09", "2026-08-10", 0.5); // expires 2026-11-07
    const co = compOffType(db)!;
    expect(expireCompOff(db, "2026-10-30")).toEqual({ expired: 0, warned: 0 });
    expect(expireCompOff(db, "2026-10-31")).toEqual({ expired: 1, warned: 1 });
    expect(db.select({ status: compOffLots.status, remaining: compOffLots.remaining }).from(compOffLots).all()).toEqual([
      { status: "expired", remaining: 0 },
      { status: "active", remaining: 0.5 },
    ]);
    expect(balanceOf(db, asha.id, co.id, 2026)).toBe(0.5);
    const warning = db.select().from(notifications).where(eq(notifications.type, "compoff.expiring")).get();
    expect(warning).toMatchObject({ userId: asha.userId, link: "/me/comp-off" });
    expect(warning!.title).toContain("½ day");
  });

  it("runs as a daily job keyed on the local date", () => {
    grant("2026-08-01", "2026-08-02");
    // 19:30 UTC on 30 Oct is 01:00 IST on 31 Oct.
    const at = new Date("2026-10-30T19:30:00Z");
    expect(runJobByName(db, "compoff:expire", at)).toEqual({ status: "succeeded", detail: "Expired 1 comp-off lot(s); warned 0 employee(s)" });
    expect(runJobByName(db, "compoff:expire", at).status).toBe("skipped");
    expect(db.select().from(leaveLedger).where(eq(leaveLedger.kind, "comp_off_lapse")).all()).toHaveLength(1);
  });
});

describe("comp-off at year end", () => {
  it("carries the active lots into the next leave year", () => {
    grant("2026-12-10", "2026-12-12");
    const co = compOffType(db)!;
    runJobByName(db, "leave:year-end", new Date("2026-12-31T19:20:00Z"));
    expect(balanceOf(db, asha.id, co.id, 2026)).toBe(0);
    expect(balanceOf(db, asha.id, co.id, 2027)).toBe(1);
  });

  it("never carries more than the lots still hold", () => {
    grant("2026-12-10", "2026-12-12");
    db.update(compOffLots).set({ remaining: 0.5 }).run();
    const co = compOffType(db)!;
    runJobByName(db, "leave:year-end", new Date("2026-12-31T19:20:00Z"));
    expect(balanceOf(db, asha.id, co.id, 2026)).toBe(0);
    expect(balanceOf(db, asha.id, co.id, 2027)).toBe(0.5);
  });
});
