import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, type EmployeeRow, type LeaveTypeRow } from "@/server/db/schema";
import { balanceOf, syncEntitlements } from "@/server/modules/leave/ledger";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
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

import { adjustBalanceAction, employeeLedgerAction } from "@/app/(app)/leave/balances/actions";

let cl: LeaveTypeRow;
let asha: EmployeeRow;

beforeEach(() => {
  state.db = createTestDb();
  seedDefaultLeaveTypes(state.db);
  cl = listLeaveTypes(state.db).find((t) => t.code === "CL")!;
  asha = insertEmployee(state.db, { firstName: "Asha", dateOfJoining: "2025-01-01" });
  syncEntitlements(state.db, asha.id, "2026-03-01");
  state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
});

describe("balance adjustments", () => {
  it("posts an adjustment with its note and audits it", async () => {
    await expect(adjustBalanceAction({ employeeId: asha.id, leaveTypeId: cl.id, year: 2026, delta: -1.5, note: "Unrecorded leave in March" })).resolves.toEqual({
      ok: true, data: { balance: 10.5 },
    });
    expect(balanceOf(state.db, asha.id, cl.id, 2026)).toBe(10.5);
    expect(state.db.select().from(auditLogs).get()).toMatchObject({ action: "leave.adjust", entityType: "employee", entityId: String(asha.id) });
  });

  it("requires a note and leave.adjust, and refuses one's own balance", async () => {
    await expect(adjustBalanceAction({ employeeId: asha.id, leaveTypeId: cl.id, year: 2026, delta: 1, note: "" })).resolves.toMatchObject({
      code: "VALIDATION", fieldErrors: { note: expect.any(Array) },
    });
    const self = insertEmployee(state.db, { userId: state.user!.id });
    state.user = sessionUserFor(state.db, getUserById(state.db, state.user!.id)!);
    await expect(adjustBalanceAction({ employeeId: self.id, leaveTypeId: cl.id, year: 2026, delta: 1, note: "Bonus day" })).resolves.toMatchObject({
      code: "SELF_ADJUST",
    });
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["payroll_admin"] }));
    await expect(adjustBalanceAction({ employeeId: asha.id, leaveTypeId: cl.id, year: 2026, delta: 1, note: "Bonus day" })).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("ledger drill-down", () => {
  it("returns an employee's entries for org-wide leave viewers only", async () => {
    await expect(employeeLedgerAction({ employeeId: asha.id, leaveTypeId: cl.id, year: 2026 })).resolves.toMatchObject({
      ok: true, data: [{ kind: "grant", delta: 12 }],
    });
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["manager"] }));
    await expect(employeeLedgerAction({ employeeId: asha.id, leaveTypeId: cl.id, year: 2026 })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
