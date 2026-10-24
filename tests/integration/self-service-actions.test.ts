import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, employees, type EmployeeRow, type UserRow } from "@/server/db/schema";
import { pendingProfileChangeFor, submitProfileChange } from "@/server/modules/employees/profile-changes";
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

import { submitBankChangeAction, updateOwnContactAction, withdrawBankChangeAction } from "@/app/(app)/me/profile/actions";

const request = (patch: Record<string, string> = {}) => ({
  bankName: "", bankAccount: "444455556666", bankIfsc: "HDFC0001234", pan: "", aadhaar: "", passport: "", reason: "New salary account",
  ...patch,
});

let hr: SessionUser;
let ashaUser: UserRow;
let asha: EmployeeRow;

beforeEach(() => {
  state.db = createTestDb();
  hr = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
  ashaUser = insertUser(state.db, { roles: ["employee"] });
  asha = createEmployee(state.db, hr, employeeInput({ bankAccount: "111122223333" }), {
    login: { mode: "link", userId: ashaUser.id }, onboarding: false,
  });
  state.user = sessionUserFor(state.db, ashaUser);
});

describe("updateOwnContactAction", () => {
  it("updates the caller's own contact details, audited", async () => {
    await expect(
      updateOwnContactAction({ personalEmail: "asha@example.com", phone: "+91 98450 12345", address: null, emergencyContact: null }),
    ).resolves.toMatchObject({ ok: true });
    expect(state.db.select().from(employees).where(eq(employees.id, asha.id)).get()).toMatchObject({
      phone: "+91 98450 12345", personalEmail: "asha@example.com",
    });
    expect(state.db.select().from(auditLogs).all().map((a) => a.action)).toEqual(["employee.update_contact"]);
  });

  it("refuses logins that have no employee record", async () => {
    state.user = hr;
    await expect(updateOwnContactAction({ personalEmail: "", phone: "", address: null, emergencyContact: null })).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("bank change requests", () => {
  it("sends one request at a time, can be withdrawn, and keeps numbers out of the audit log", async () => {
    const sent = await submitBankChangeAction(request());
    if (!sent.ok) throw new Error(sent.error);
    await expect(submitBankChangeAction(request())).resolves.toMatchObject({ code: "PENDING_EXISTS" });
    await expect(withdrawBankChangeAction({ requestId: sent.data.id })).resolves.toMatchObject({ ok: true });
    expect(pendingProfileChangeFor(state.db, asha.id)).toBeUndefined();
    expect(JSON.stringify(state.db.select().from(auditLogs).all())).not.toContain("444455556666");
  });

  it("validates formats and cannot withdraw someone else's request", async () => {
    await expect(submitBankChangeAction(request({ bankIfsc: "HDFC1" }))).resolves.toMatchObject({
      ok: false, code: "VALIDATION", fieldErrors: { bankIfsc: ["Use an 11-character IFSC, e.g. HDFC0001234"] },
    });
    const raviUser = insertUser(state.db);
    const ravi = createEmployee(state.db, hr, employeeInput({ firstName: "Ravi" }), {
      login: { mode: "link", userId: raviUser.id }, onboarding: false,
    });
    const theirs = submitProfileChange(
      state.db, ravi.id, raviUser.id,
      { bankName: null, bankAccount: null, bankIfsc: "HDFC0001234", pan: null, aadhaar: null, passport: null }, null,
    );
    await expect(withdrawBankChangeAction({ requestId: theirs.id })).resolves.toMatchObject({ code: "NOT_FOUND" });
  });
});
