import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { attendancePunches, auditLogs, compOffClaims, regularizationRequests } from "@/server/db/schema";
import { recomputeAttendance } from "@/server/modules/attendance/compute";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { requestRegularizationAction, withdrawRegularizationAction } from "@/app/(app)/me/attendance/actions";
import { claimCompOffAction, withdrawCompOffClaimAction } from "@/app/(app)/me/comp-off/actions";

let employeeId: number;
const audits = () => state.db.select().from(auditLogs).all().map((a) => a.action);

beforeEach(() => {
  // Tuesday 10 Nov 2026, 09:40 IST.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T04:10:00Z"));
  state.db = createTestDb();
  seedDefaultShift(state.db);
  seedDefaultLeaveTypes(state.db);
  const login = insertUser(state.db);
  employeeId = insertEmployee(state.db, { dateOfJoining: "2025-01-01", userId: login.id }).id;
  state.user = sessionUserFor(state.db, login);
});
afterEach(() => vi.useRealTimers());

describe("regularization", () => {
  it("requests a correction for a past day and withdraws it", async () => {
    const result = await requestRegularizationAction({ date: "2026-11-09", requestedIn: "09:30", requestedOut: "18:30", reason: "Forgot to clock in" });
    expect(result).toMatchObject({ ok: true, data: { status: "pending" } });
    const id = (result as { data: { id: number } }).data.id;
    await expect(withdrawRegularizationAction({ id })).resolves.toEqual({ ok: true, data: { status: "withdrawn" } });
    expect(state.db.select().from(regularizationRequests).get()).toMatchObject({ requestedIn: 570, requestedOut: 1110, status: "withdrawn" });
    expect(audits()).toEqual(["regularization.request", "regularization.withdraw"]);
  });

  it("refuses today with a field error", async () => {
    await expect(
      requestRegularizationAction({ date: "2026-11-10", requestedIn: "09:30", requestedOut: "18:30", reason: "Forgot" }),
    ).resolves.toMatchObject({ ok: false, code: "FUTURE_DATE", fieldErrors: { date: ["Past days only"] } });
  });
});

describe("comp-off claims", () => {
  it("claims off-day work and withdraws the claim", async () => {
    state.db.insert(attendancePunches).values([
      { employeeId, at: "2026-11-07T04:30:00.000Z", date: "2026-11-07", direction: "in" },
      { employeeId, at: "2026-11-07T13:00:00.000Z", date: "2026-11-07", direction: "out" },
    ]).run();
    recomputeAttendance(state.db, employeeId, "2026-11-07", "2026-11-07");
    const result = await claimCompOffAction({ workedDate: "2026-11-07", reason: "Release support" });
    expect(result).toMatchObject({ ok: true, data: { status: "pending", daysRequested: 1 } });
    const claimId = (result as { data: { id: number } }).data.id;
    await expect(withdrawCompOffClaimAction({ claimId })).resolves.toEqual({ ok: true, data: { status: "withdrawn" } });
    expect(state.db.select().from(compOffClaims).get()).toMatchObject({ status: "withdrawn" });
    expect(audits()).toEqual(["compoff.claim", "compoff.withdraw"]);
  });

  it("refuses a working day", async () => {
    await expect(claimCompOffAction({ workedDate: "2026-11-09", reason: null })).resolves.toMatchObject({ ok: false });
  });
});
