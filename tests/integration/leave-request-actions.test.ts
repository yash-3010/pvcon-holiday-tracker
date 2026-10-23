import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, leaveRequests, type EmployeeRow, type LeaveTypeRow } from "@/server/db/schema";
import { balanceOf, syncEntitlements } from "@/server/modules/leave/ledger";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
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

import { cancelLeaveAction } from "@/app/(app)/me/leave/actions";
import { recordLeaveAction } from "@/app/(app)/leave/requests/actions";

let dir: string;
let types: Record<string, LeaveTypeRow>;
let asha: EmployeeRow;
let hr: SessionUser;

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries({ startHalf: "full", endHalf: "full", reason: "", ...values })) data.set(k, v);
  return data;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T05:00:00Z"));
  dir = mkdtempSync(path.join(tmpdir(), "pvcon-record-"));
  vi.stubEnv("UPLOAD_DIR", dir);
  state.db = createTestDb();
  seedDefaultLeaveTypes(state.db);
  types = Object.fromEntries(listLeaveTypes(state.db).map((t) => [t.code, t]));
  asha = insertEmployee(state.db, { firstName: "Asha", dateOfJoining: "2025-01-01" });
  syncEntitlements(state.db, asha.id, "2026-10-20");
  hr = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
  state.user = hr;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("recording leave for an employee", () => {
  it("creates approved leave with a ledger debit, and HR can cancel it", async () => {
    const result = await recordLeaveAction(
      form({ employeeId: String(asha.id), leaveTypeId: String(types.CL.id), startDate: "2026-10-12", endDate: "2026-10-16" }),
    );
    expect(result).toMatchObject({ ok: true, data: { days: 5, status: "approved" } });
    expect(balanceOf(state.db, asha.id, types.CL.id, 2026)).toBe(7);
    const request = state.db.select().from(leaveRequests).get()!;
    await expect(cancelLeaveAction({ requestId: request.id, note: "Entered twice" })).resolves.toEqual({ ok: true, data: { status: "cancelled" } });
    expect(balanceOf(state.db, asha.id, types.CL.id, 2026)).toBe(12);
    expect(state.db.select().from(auditLogs).all().map((a) => a.action)).toEqual(["leave.record", "leave.cancel"]);
  });

  it("is only for leave.adjust holders", async () => {
    const manager = insertUser(state.db, { roles: ["manager"] });
    state.user = sessionUserFor(state.db, manager);
    await expect(
      recordLeaveAction(form({ employeeId: String(asha.id), leaveTypeId: String(types.CL.id), startDate: "2026-10-12", endDate: "2026-10-12" })),
    ).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
