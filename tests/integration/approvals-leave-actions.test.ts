import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, leaveRequests, type EmployeeRow, type LeaveTypeRow } from "@/server/db/schema";
import { postLedger, syncEntitlements } from "@/server/modules/leave/ledger";
import { applyLeave } from "@/server/modules/leave/requests";
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

import { bulkApproveLeaveAction, decideLeaveAction } from "@/app/(app)/approvals/actions";

const TODAY = "2026-10-20";
let types: Record<string, LeaveTypeRow>;
type Person = { employee: EmployeeRow; user: SessionUser };
let ravi: Person, asha: Person, meera: Person;

function person(name: string, overrides: Partial<EmployeeRow> = {}): Person {
  const login = insertUser(state.db, { roles: ["employee"], name });
  const employee = insertEmployee(state.db, { firstName: name, dateOfJoining: "2025-01-01", userId: login.id, ...overrides });
  syncEntitlements(state.db, employee.id, TODAY);
  return { employee, user: sessionUserFor(state.db, login) };
}
const apply = (p: Person, date: string) =>
  applyLeave(state.db, p.user, { leaveTypeId: types.CL.id, startDate: date, endDate: date, startHalf: "full", endHalf: "full", reason: null }, { today: TODAY, attachmentFileId: null });
const status = (id: number) => state.db.select().from(leaveRequests).where(eq(leaveRequests.id, id)).get()!.status;

beforeEach(() => {
  state.db = createTestDb();
  seedDefaultLeaveTypes(state.db);
  types = Object.fromEntries(listLeaveTypes(state.db).map((t) => [t.code, t]));
  ravi = person("Ravi");
  asha = person("Asha", { reportingManagerId: ravi.employee.id });
  meera = person("Meera");
  ravi = { ...ravi, user: sessionUserFor(state.db, getUserById(state.db, ravi.user.id)!) };
  state.user = ravi.user;
});

describe("leave approvals", () => {
  it("lets a manager approve or reject their report's leave, with an audit entry", async () => {
    const first = apply(asha, "2026-11-02");
    const second = apply(asha, "2026-11-03");
    await expect(decideLeaveAction({ requestId: first.id, decision: "approved", note: "" })).resolves.toEqual({ ok: true, data: { status: "approved" } });
    await expect(decideLeaveAction({ requestId: second.id, decision: "rejected", note: "Release" })).resolves.toEqual({ ok: true, data: { status: "rejected" } });
    expect(state.db.select().from(auditLogs).all().map((a) => a.action)).toEqual(["leave.approve", "leave.reject"]);
  });

  it("refuses requests outside the reporting line", async () => {
    const other = apply(meera, "2026-11-02");
    await expect(decideLeaveAction({ requestId: other.id, decision: "approved", note: null })).resolves.toMatchObject({ code: "FORBIDDEN" });
    expect(status(other.id)).toBe("pending");
  });

  it("needs leave.approve", async () => {
    const request = apply(asha, "2026-11-02");
    state.user = meera.user;
    await expect(decideLeaveAction({ requestId: request.id, decision: "approved", note: null })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("approves in bulk and reports what could not be approved", async () => {
    const first = apply(asha, "2026-11-02");
    const second = apply(asha, "2026-11-03");
    postLedger(state.db, { employeeId: asha.employee.id, leaveTypeId: types.CL.id, year: 2026, date: TODAY, delta: -11, kind: "adjustment" });
    const result = await bulkApproveLeaveAction({ requestIds: [first.id, second.id], note: null });
    expect(result).toMatchObject({ ok: true, data: { approved: 1, failed: [{ id: second.id }] } });
    expect([status(first.id), status(second.id)]).toEqual(["approved", "pending"]);
    expect(state.db.select().from(auditLogs).all().map((a) => [a.action, a.entityId])).toEqual([["leave.approve", String(first.id)]]);
  });
});
