import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { CreateEmployeeFormValues } from "@/lib/validation/employees";
import type { DB } from "@/server/db/client";
import { auditLogs, employees } from "@/server/db/schema";
import { listEmployeeChecklists, seedDefaultChecklistTemplates } from "@/server/modules/employees/checklists";
import { findUserByEmail } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
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

import { createEmployeeAction } from "@/app/(app)/org/employees/actions";

const input = (patch: Partial<CreateEmployeeFormValues> = {}): CreateEmployeeFormValues => ({
  firstName: "Asha", lastName: "Rao", displayName: "", workEmail: "asha@pvcon.in", personalEmail: "", phone: "",
  dateOfBirth: "", gender: null, maritalStatus: null, address: null, emergencyContact: null,
  departmentId: null, designationId: null, reportingManagerId: null, employmentType: "full_time", workLocation: "",
  dateOfJoining: "2026-10-01", probationEndDate: "", confirmationDate: "", noticePeriodDays: 30,
  bankName: "", bankAccount: "", bankIfsc: "", pan: "", aadhaar: "", passport: "",
  employeeCode: "", loginMode: "none", loginRoles: ["employee"], linkUserId: null,
  ...patch,
});

let hr: SessionUser;
beforeEach(() => {
  state.db = createTestDb();
  seedDefaultChecklistTemplates(state.db);
  hr = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
  state.user = hr;
});

describe("createEmployeeAction", () => {
  it("creates the employee with an onboarding checklist and a login whose temporary password is shown once", async () => {
    const result = await createEmployeeAction(input({ loginMode: "create" }));
    if (!result.ok) throw new Error(result.error);
    expect(result.data).toMatchObject({ employeeCode: "PV0001", loginEmail: "asha@pvcon.in" });
    const user = findUserByEmail(state.db, "asha@pvcon.in")!;
    expect(bcrypt.compareSync(result.data.tempPassword!, user.passwordHash)).toBe(true);
    expect(listEmployeeChecklists(state.db, result.data.id).map((c) => c.kind)).toEqual(["onboarding"]);
    expect(state.db.select().from(auditLogs).all().map((a) => a.action)).toEqual(["employee.create"]);
  });

  it("returns no password when no login is created", async () => {
    await expect(createEmployeeAction(input())).resolves.toMatchObject({ ok: true, data: { tempPassword: null, loginEmail: null } });
  });

  it("refuses logins outside the company domain and missing work emails, as field errors", async () => {
    await expect(createEmployeeAction(input({ loginMode: "create", workEmail: "asha@gmail.com" }))).resolves.toMatchObject({
      ok: false, code: "EMAIL_DOMAIN", fieldErrors: { workEmail: ["Must be an @pvcon.in address"] },
    });
    await expect(createEmployeeAction(input({ loginMode: "create", workEmail: "" }))).resolves.toMatchObject({
      ok: false, code: "VALIDATION", fieldErrors: { workEmail: ["Required to create a login"] },
    });
    expect(state.db.select().from(employees).all()).toEqual([]);
  });

  it("needs employee.create, and user management rights to create or link a login", async () => {
    state.user = { ...hr, permissions: hr.permissions.filter((p) => p !== "user.manage") };
    await expect(createEmployeeAction(input({ loginMode: "create" }))).resolves.toMatchObject({ code: "FORBIDDEN" });
    await expect(createEmployeeAction(input())).resolves.toMatchObject({ ok: true });
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["payroll_admin"] }));
    await expect(createEmployeeAction(input({ workEmail: "ravi@pvcon.in" }))).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
