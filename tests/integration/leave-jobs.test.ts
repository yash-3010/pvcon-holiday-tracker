import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { employees, jobRuns, leaveLedger, type LeaveTypeRow } from "@/server/db/schema";
import { runJobByName } from "@/server/jobs/registry";
import { balanceOf, postLedger } from "@/server/modules/leave/ledger";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { patchSetting } from "@/server/modules/settings/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";

let db: DB;
let cl: LeaveTypeRow;

beforeEach(() => {
  db = createTestDb();
  seedDefaultLeaveTypes(db);
  cl = listLeaveTypes(db).find((t) => t.code === "CL")!;
});

const runKeys = (job: string) => db.select({ key: jobRuns.runKey }).from(jobRuns).where(eq(jobRuns.job, job)).all().map((r) => r.key);

describe("leave:accrue", () => {
  it("syncs current employees once per local month", () => {
    const current = insertEmployee(db, { dateOfJoining: "2025-06-01" });
    const leaving = insertEmployee(db, { dateOfJoining: "2025-06-01", status: "on_notice" });
    const gone = insertEmployee(db, { dateOfJoining: "2025-06-01", status: "exited" });
    // 19:15 UTC on 28 Feb is 00:45 on 1 March in Asia/Kolkata.
    const at = new Date("2026-02-28T19:15:00Z");
    expect(runJobByName(db, "leave:accrue", at)).toEqual({ status: "succeeded", detail: "Granted 4, accrued 0 for 2 employee(s)" });
    expect(runKeys("leave:accrue")).toEqual(["2026-03"]);
    expect(runJobByName(db, "leave:accrue", at).status).toBe("skipped");
    expect(balanceOf(db, current.id, cl.id, 2026)).toBe(12);
    expect(balanceOf(db, leaving.id, cl.id, 2026)).toBe(12);
    expect(balanceOf(db, gone.id, cl.id, 2026)).toBe(0);
  });
});

describe("leave:year-end", () => {
  function withBalance(balance: number) {
    const e = insertEmployee(db, { dateOfJoining: "2024-01-01" });
    postLedger(db, { employeeId: e.id, leaveTypeId: cl.id, year: 2026, date: "2026-01-01", delta: balance, kind: "grant" });
    return e;
  }

  it("closes the previous leave year on the 1st and grants the new one", () => {
    const e = withBalance(8);
    // 19:20 UTC on 31 Dec is 00:50 on 1 Jan in Asia/Kolkata.
    const at = new Date("2026-12-31T19:20:00Z");
    expect(runJobByName(db, "leave:year-end", at)).toMatchObject({ status: "succeeded" });
    expect(runKeys("leave:year-end")).toEqual(["2026"]);
    expect(balanceOf(db, e.id, cl.id, 2026)).toBe(0);
    expect(balanceOf(db, e.id, cl.id, 2027)).toBe(6 + 12);
    expect(runJobByName(db, "leave:year-end", at).status).toBe("skipped");
  });

  it("still closes the right year when it runs late", () => {
    const e = withBalance(2);
    runJobByName(db, "leave:year-end", new Date("2027-01-15T04:00:00Z"));
    expect(runKeys("leave:year-end")).toEqual(["2026"]);
    expect(balanceOf(db, e.id, cl.id, 2027)).toBe(2 + 12);
  });

  it("closes the balances of employees who have since exited", () => {
    const e = withBalance(3);
    db.update(employees).set({ status: "exited" }).run();
    runJobByName(db, "leave:year-end", new Date("2026-12-31T19:20:00Z"));
    const carried = db
      .select()
      .from(leaveLedger)
      .where(and(eq(leaveLedger.employeeId, e.id), eq(leaveLedger.kind, "carry_forward")))
      .all();
    expect(carried.map((r) => r.delta)).toEqual([-3, 3]);
  });

  it("follows an April leave year", () => {
    patchSetting(db, "leave", { yearStartMonth: 4 }, null);
    const e = withBalance(1);
    runJobByName(db, "leave:year-end", new Date("2027-03-31T19:20:00Z"));
    expect(runKeys("leave:year-end")).toEqual(["2026"]);
    expect(balanceOf(db, e.id, cl.id, 2026)).toBe(0);
    expect(balanceOf(db, e.id, cl.id, 2027)).toBe(1 + 12);
  });

  it("does not use up the next close when it runs mid-way through an April leave year", () => {
    patchSetting(db, "leave", { yearStartMonth: 4 }, null);
    withBalance(1);
    runJobByName(db, "leave:year-end", new Date("2027-01-15T04:00:00Z"));
    expect(runJobByName(db, "leave:year-end", new Date("2027-03-31T19:20:00Z")).status).toBe("succeeded");
    expect(runKeys("leave:year-end")).toEqual(["2025", "2026"]);
  });
});
