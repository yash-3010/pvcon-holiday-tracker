import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, type UserRow } from "@/server/db/schema";
import { findUserByEmail, getUserById, getUserRoles, loadSessionUser } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

// Only the Next.js runtime boundary is replaced.
const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import {
  createUserAction,
  resetUserPasswordAction,
  setUserStatusAction,
  updateUserRolesAction,
} from "@/app/(app)/settings/users/actions";

let superRow: UserRow;
let hrRow: UserRow;
let employeeRow: UserRow;
let asSuper: SessionUser;
let asHr: SessionUser;
let asEmployee: SessionUser;
const stillSignedIn = (row: UserRow) => loadSessionUser(state.db, row.id, row.sessionVersion) !== null;
const auditActions = () => state.db.select().from(auditLogs).all().map((r) => r.action);

beforeEach(() => {
  state.db = createTestDb();
  superRow = insertUser(state.db, { email: "root@pvcon.in", roles: ["super_admin"] });
  hrRow = insertUser(state.db, { email: "hr@pvcon.in", roles: ["hr_admin"] });
  employeeRow = insertUser(state.db, { email: "asha@pvcon.in", roles: ["employee"] });
  asSuper = sessionUserFor(state.db, superRow);
  asHr = sessionUserFor(state.db, hrRow);
  asEmployee = sessionUserFor(state.db, employeeRow);
  state.user = asHr;
});

describe("createUserAction", () => {
  it("creates a user with a one-time temporary password that must be changed", async () => {
    const result = await createUserAction({ name: "Ravi Menon", email: "Ravi.Menon@PVCON.in", roles: ["employee", "manager"] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = findUserByEmail(state.db, "ravi.menon@pvcon.in")!;
    expect(result.data).toMatchObject({ userId: stored.id, email: "ravi.menon@pvcon.in" });
    expect(bcrypt.compareSync(result.data.tempPassword, stored.passwordHash)).toBe(true);
    expect(stored.mustChangePassword).toBe(true);
    expect(getUserRoles(state.db, stored.id)).toEqual(["employee", "manager"]);
    expect(auditActions()).toContain("user.create");
  });

  it("rejects addresses outside the company domain and duplicate emails", async () => {
    await expect(createUserAction({ name: "Out Sider", email: "out@gmail.com", roles: ["employee"] })).resolves.toMatchObject({
      ok: false,
      code: "EMAIL_DOMAIN",
      fieldErrors: { email: ["Must be an @pvcon.in address"] },
    });
    await expect(createUserAction({ name: "Asha Again", email: "asha@pvcon.in", roles: ["employee"] })).resolves.toMatchObject({
      ok: false,
      code: "EMAIL_TAKEN",
    });
    expect(findUserByEmail(state.db, "out@gmail.com")).toBeUndefined();
  });

  it("requires at least one role", async () => {
    const result = await createUserAction({ name: "No Roles", email: "none@pvcon.in", roles: [] });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { roles: ["Pick at least one role"] } });
  });

  it("lets only role.assign holders grant privileged roles", async () => {
    await expect(createUserAction({ name: "New Hr", email: "newhr@pvcon.in", roles: ["hr_admin"] })).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN_ROLE",
    });
    expect(findUserByEmail(state.db, "newhr@pvcon.in")).toBeUndefined();

    state.user = asSuper;
    await expect(createUserAction({ name: "New Hr", email: "newhr@pvcon.in", roles: ["hr_admin"] })).resolves.toMatchObject({ ok: true });
  });

  it("is forbidden without user.manage or role.assign", async () => {
    state.user = asEmployee;
    await expect(createUserAction({ name: "Sneaky User", email: "sneaky@pvcon.in", roles: ["employee"] })).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("resetUserPasswordAction", () => {
  it("issues a temporary password, forces a change and signs the user out everywhere", async () => {
    const result = await resetUserPasswordAction({ userId: employeeRow.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = getUserById(state.db, employeeRow.id)!;
    expect(result.data.email).toBe("asha@pvcon.in");
    expect(bcrypt.compareSync(result.data.tempPassword, stored.passwordHash)).toBe(true);
    expect(stored.mustChangePassword).toBe(true);
    expect(stillSignedIn(employeeRow)).toBe(false);
    expect(auditActions()).toContain("user.password_reset");
  });

  it("does not let HR take over a privileged account", async () => {
    await expect(resetUserPasswordAction({ userId: superRow.id })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN_ROLE" });
    expect(getUserById(state.db, superRow.id)!.passwordHash).toBe(superRow.passwordHash);
    expect(stillSignedIn(superRow)).toBe(true);
  });

  it("reports unknown users", async () => {
    await expect(resetUserPasswordAction({ userId: 9999 })).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("setUserStatusAction", () => {
  it("disables and re-enables a user, revoking their sessions on disable", async () => {
    await expect(setUserStatusAction({ userId: employeeRow.id, status: "disabled" })).resolves.toEqual({
      ok: true,
      data: { status: "disabled" },
    });
    expect(stillSignedIn(employeeRow)).toBe(false);
    await expect(setUserStatusAction({ userId: employeeRow.id, status: "active" })).resolves.toEqual({
      ok: true,
      data: { status: "active" },
    });
    expect(auditActions()).toEqual(expect.arrayContaining(["user.disable", "user.enable"]));
  });

  it("refuses self-disable and HR disabling a privileged account", async () => {
    await expect(setUserStatusAction({ userId: hrRow.id, status: "disabled" })).resolves.toMatchObject({ ok: false });
    await expect(setUserStatusAction({ userId: superRow.id, status: "disabled" })).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN_ROLE",
    });
    state.user = asSuper;
    await expect(setUserStatusAction({ userId: superRow.id, status: "disabled" })).resolves.toMatchObject({
      ok: false,
      code: "SELF_DISABLE",
    });
    expect(getUserById(state.db, superRow.id)!.status).toBe("active");
  });
});

describe("updateUserRolesAction", () => {
  it("lets HR grant manager but not privileged roles", async () => {
    await expect(updateUserRolesAction({ userId: employeeRow.id, roles: ["employee", "manager"] })).resolves.toEqual({
      ok: true,
      data: { roles: ["employee", "manager"] },
    });
    await expect(updateUserRolesAction({ userId: employeeRow.id, roles: ["employee", "payroll_admin"] })).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN_ROLE",
    });
    expect(getUserRoles(state.db, employeeRow.id)).toEqual(["employee", "manager"]);
  });

  it("lets a super admin grant payroll admin, which signs the target out", async () => {
    state.user = asSuper;
    await expect(updateUserRolesAction({ userId: employeeRow.id, roles: ["employee", "payroll_admin"] })).resolves.toMatchObject({
      ok: true,
    });
    expect(getUserRoles(state.db, employeeRow.id)).toEqual(["employee", "payroll_admin"]);
    expect(stillSignedIn(employeeRow)).toBe(false);
    expect(auditActions()).toContain("user.roles");
  });
});
