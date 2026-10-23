import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, compOffLots, type EmployeeRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { compOffAvailable } from "@/server/modules/compoff/service";
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
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { grantCompOffAction } from "@/app/(app)/leave/comp-off/actions";

let hr: { employee: EmployeeRow; user: SessionUser };
let asha: EmployeeRow;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T06:00:00Z"));
  state.db = createTestDb();
  seedDefaultShift(state.db);
  seedDefaultLeaveTypes(state.db);
  const login = insertUser(state.db, { roles: ["employee", "hr_admin"] });
  hr = { employee: insertEmployee(state.db, { dateOfJoining: "2025-01-01", userId: login.id }), user: sessionUserFor(state.db, login) };
  asha = insertEmployee(state.db, { dateOfJoining: "2025-01-01" });
  state.user = hr.user;
});
afterEach(() => vi.useRealTimers());

describe("grant comp-off", () => {
  it("creates a lot that can be used, with an audit entry", async () => {
    await expect(grantCompOffAction({ employeeId: asha.id, days: 1.5, earnedOn: "2026-11-01", note: "Diwali release support" })).resolves.toMatchObject({
      ok: true, data: { days: 1.5, expiresOn: "2027-01-30" },
    });
    expect(compOffAvailable(state.db, asha.id, "2026-11-12")).toBe(1.5);
    expect(state.db.select().from(auditLogs).all().map((a) => [a.action, a.entityType])).toEqual([["compoff.grant", "employee"]]);
  });

  it("refuses one's own record, future work, work before joining and half-step violations", async () => {
    await expect(grantCompOffAction({ employeeId: hr.employee.id, days: 1, earnedOn: "2026-11-01", note: "Mine" })).resolves.toMatchObject({
      code: "SELF_ADJUST",
    });
    await expect(grantCompOffAction({ employeeId: asha.id, days: 1, earnedOn: "2026-11-11", note: "Ahead" })).resolves.toMatchObject({
      code: "FUTURE_DATE", fieldErrors: { earnedOn: ["Not yet"] },
    });
    await expect(grantCompOffAction({ employeeId: asha.id, days: 1, earnedOn: "2025-06-02", note: "Old" })).resolves.toMatchObject({
      code: "ALREADY_EXPIRED",
    });
    const late = insertEmployee(state.db, { dateOfJoining: "2026-11-05" });
    await expect(grantCompOffAction({ employeeId: late.id, days: 1, earnedOn: "2026-11-01", note: "Before" })).resolves.toMatchObject({
      code: "NOT_EMPLOYED",
    });
    await expect(grantCompOffAction({ employeeId: asha.id, days: 0.7, earnedOn: "2026-11-01", note: "Odd" })).resolves.toMatchObject({
      code: "VALIDATION",
    });
    expect(state.db.select().from(compOffLots).all()).toEqual([]);
  });

  it("needs leave.adjust", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["payroll_admin"] }));
    await expect(grantCompOffAction({ employeeId: asha.id, days: 1, earnedOn: "2026-11-01", note: "Work" })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
