import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, employees, type EmployeeRow, type ProfileChangeRequestRow, type UserRow } from "@/server/db/schema";
import { submitProfileChange } from "@/server/modules/employees/profile-changes";
import { openBank } from "@/server/modules/employees/sensitive";
import { createEmployee } from "@/server/modules/employees/service";
import { createTestDb } from "../helpers/db";
import { employeeInput } from "../helpers/employees";
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

import { decideProfileChangeAction } from "@/app/(app)/approvals/actions";
import { updateEmployeeSettingsAction } from "@/app/(app)/settings/employee/actions";

const newAccount = { bankName: null, bankAccount: "444455556666", bankIfsc: "HDFC0001234", pan: null, aadhaar: null, passport: null };
let hrUser: UserRow;
let hr: SessionUser;
let asha: EmployeeRow;
let request: ProfileChangeRequestRow;
const employeeRow = (id: number) => state.db.select().from(employees).where(eq(employees.id, id)).get()!;

beforeEach(() => {
  state.db = createTestDb();
  hrUser = insertUser(state.db, { roles: ["hr_admin"] });
  hr = sessionUserFor(state.db, hrUser);
  const ashaUser = insertUser(state.db, { roles: ["employee"] });
  asha = createEmployee(state.db, hr, employeeInput({ bankAccount: "111122223333" }), {
    login: { mode: "link", userId: ashaUser.id }, onboarding: false,
  });
  request = submitProfileChange(state.db, asha.id, ashaUser.id, newAccount, "New account");
  state.user = hr;
});

describe("decideProfileChangeAction", () => {
  it("approves with a masked audit trail", async () => {
    await expect(decideProfileChangeAction({ requestId: request.id, decision: "approved", note: "Verified" })).resolves.toEqual({
      ok: true, data: { status: "approved" },
    });
    expect(openBank(employeeRow(asha.id)).bankAccount).toBe("444455556666");
    const entry = state.db.select().from(auditLogs).where(eq(auditLogs.action, "profile_change.approve")).get()!;
    expect(entry.diff).toMatchObject({ bankAccount: { from: "XXXX3333", to: "XXXX6666" } });
    expect(JSON.stringify(entry)).not.toContain("444455556666");
  });

  it("rejects without touching the bank details", async () => {
    await expect(decideProfileChangeAction({ requestId: request.id, decision: "rejected", note: "" })).resolves.toEqual({
      ok: true, data: { status: "rejected" },
    });
    expect(openBank(employeeRow(asha.id)).bankAccount).toBe("111122223333");
  });

  it("needs employee.update plus sensitive access, and nobody decides their own request", async () => {
    state.user = { ...hr, permissions: hr.permissions.filter((p) => p !== "employee.sensitive.view") };
    await expect(decideProfileChangeAction({ requestId: request.id, decision: "approved", note: null })).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
    const hari = createEmployee(state.db, hr, employeeInput({ firstName: "Hari" }), { login: { mode: "link", userId: hrUser.id }, onboarding: false });
    const own = submitProfileChange(state.db, hari.id, hrUser.id, newAccount, null);
    state.user = sessionUserFor(state.db, hrUser);
    await expect(decideProfileChangeAction({ requestId: own.id, decision: "approved", note: null })).resolves.toMatchObject({
      code: "SELF_APPROVAL",
    });
  });
});

describe("updateEmployeeSettingsAction", () => {
  it("saves the code format and reports the next code", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["super_admin"] }));
    await expect(updateEmployeeSettingsAction({ codePrefix: "EMP", codeDigits: 3 })).resolves.toEqual({ ok: true, data: { nextCode: "EMP001" } });
  });

  it("is limited to settings.manage holders", async () => {
    await expect(updateEmployeeSettingsAction({ codePrefix: "EMP", codeDigits: 3 })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
