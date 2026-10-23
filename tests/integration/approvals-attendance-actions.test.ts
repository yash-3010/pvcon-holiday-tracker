import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { attendanceDays, attendancePunches, auditLogs, compOffLots, type EmployeeRow } from "@/server/db/schema";
import { recomputeAttendance } from "@/server/modules/attendance/compute";
import { requestRegularization } from "@/server/modules/attendance/regularization";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { submitCompOffClaim } from "@/server/modules/compoff/service";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { patchSetting } from "@/server/modules/settings/service";
import { getUserById } from "@/server/modules/users/service";
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
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { decideCompOffAction, decideRegularizationAction } from "@/app/(app)/approvals/actions";

// Tuesday 10 Nov 2026, 11:30 IST.
const TODAY = "2026-11-10";
type Person = { employee: EmployeeRow; user: SessionUser };
let ravi: Person, asha: Person, meera: Person;

function person(name: string, overrides: Partial<EmployeeRow> = {}): Person {
  const login = insertUser(state.db, { roles: ["employee"], name });
  const employee = insertEmployee(state.db, { firstName: name, dateOfJoining: "2025-01-01", userId: login.id, ...overrides });
  return { employee, user: sessionUserFor(state.db, login) };
}
const audits = () => state.db.select().from(auditLogs).all().map((a) => a.action);
const regularize = (date: string) =>
  requestRegularization(state.db, asha.user, { date, requestedIn: 570, requestedOut: 1110, reason: "Forgot to punch" }, { today: TODAY });
function workedSaturday() {
  state.db.insert(attendancePunches).values([
    { employeeId: asha.employee.id, at: "2026-11-07T04:30:00.000Z", date: "2026-11-07", direction: "in" },
    { employeeId: asha.employee.id, at: "2026-11-07T13:00:00.000Z", date: "2026-11-07", direction: "out" },
  ]).run();
  recomputeAttendance(state.db, asha.employee.id, "2026-11-07", "2026-11-07");
  return submitCompOffClaim(state.db, asha.user, { workedDate: "2026-11-07", reason: null }, { today: TODAY });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T06:00:00Z"));
  state.db = createTestDb();
  seedDefaultShift(state.db);
  seedDefaultLeaveTypes(state.db);
  ravi = person("Ravi");
  asha = person("Asha", { reportingManagerId: ravi.employee.id });
  meera = person("Meera");
  ravi = { ...ravi, user: sessionUserFor(state.db, getUserById(state.db, ravi.user.id)!) };
  state.user = ravi.user;
});
afterEach(() => vi.useRealTimers());

describe("regularization approvals", () => {
  it("approves a correction, rewriting the day, and rejects another", async () => {
    const first = regularize("2026-11-09");
    const second = regularize("2026-11-06");
    await expect(decideRegularizationAction({ id: first.id, decision: "approved", note: "" })).resolves.toEqual({ ok: true, data: { status: "approved" } });
    await expect(decideRegularizationAction({ id: second.id, decision: "rejected", note: "No proof" })).resolves.toEqual({ ok: true, data: { status: "rejected" } });
    const day = state.db.select().from(attendanceDays).where(eq(attendanceDays.date, "2026-11-09")).get();
    expect(day).toMatchObject({ status: "present", firstIn: 570, lastOut: 1110 });
    expect(audits()).toEqual(["regularization.approve", "regularization.reject"]);
  });

  it("refuses people outside the approver's team and one's own requests", async () => {
    const request = regularize("2026-11-09");
    state.user = meera.user;
    await expect(decideRegularizationAction({ id: request.id, decision: "approved", note: "" })).resolves.toMatchObject({ code: "FORBIDDEN" });
    state.user = asha.user;
    await expect(decideRegularizationAction({ id: request.id, decision: "approved", note: "" })).resolves.toMatchObject({ ok: false });
  });
});

describe("comp-off approvals", () => {
  it("approves a claim as leave, creating a lot", async () => {
    const claim = workedSaturday();
    await expect(decideCompOffAction({ claimId: claim.id, decision: "approved", resolution: "leave", note: "Thanks" })).resolves.toEqual({
      ok: true, data: { status: "approved" },
    });
    expect(state.db.select().from(compOffLots).all()).toMatchObject([{ employeeId: asha.employee.id, days: 1, remaining: 1, earnedOn: "2026-11-07" }]);
    expect(audits()).toEqual(["compoff.approve"]);
  });

  it("pays out only when payout is switched on, and rejects with a note", async () => {
    const claim = workedSaturday();
    await expect(decideCompOffAction({ claimId: claim.id, decision: "approved", resolution: "payout", note: null })).resolves.toMatchObject({
      ok: false, code: "PAYOUT_DISABLED",
    });
    patchSetting(state.db, "compOff", { payoutEnabled: true }, null);
    await expect(decideCompOffAction({ claimId: claim.id, decision: "approved", resolution: "payout", note: null })).resolves.toMatchObject({ ok: true });
    expect(state.db.select().from(compOffLots).all()).toEqual([]);
    expect(audits()).toEqual(["compoff.approve"]);
  });

  it("rejects a claim", async () => {
    const claim = workedSaturday();
    await expect(decideCompOffAction({ claimId: claim.id, decision: "rejected", note: "Not approved overtime" })).resolves.toEqual({
      ok: true, data: { status: "rejected" },
    });
    expect(audits()).toEqual(["compoff.reject"]);
  });
});
