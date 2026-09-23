import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { passwordProblems } from "@/lib/auth/password-policy";
import { permissionsForRoles } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { users } from "@/server/db/schema";
import {
  changePassword, createPasswordResetToken, createUser, generateTempPassword, getUserById, listUsers,
  loadSessionUser, resetPasswordWithToken, setTemporaryPassword, setUserRoles, setUserStatus, verifyCredentials,
} from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { TEST_COST, TEST_PASSWORD, expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const LOGIN = { lockoutAttempts: 3, lockoutMinutes: 15, cost: TEST_COST };
const POLICY = { minLength: 10 };
let db: DB;
beforeEach(() => {
  db = createTestDb();
});

describe("verifyCredentials", () => {
  it("accepts the right password case-insensitively on email and resets counters", async () => {
    const u = insertUser(db, { email: "a@pvcon.in" });
    db.update(users).set({ failedLoginCount: 2 }).where(eq(users.id, u.id)).run();
    const now = new Date("2026-09-24T10:00:00Z");
    const res = await verifyCredentials(db, "A@PVCON.IN", TEST_PASSWORD, { ...LOGIN, now });
    expect(res.ok).toBe(true);
    const after = getUserById(db, u.id)!;
    expect(after.failedLoginCount).toBe(0);
    expect(after.lastLoginAt).toBe(now.toISOString());
  });

  it("rejects unknown emails as invalid", async () => {
    const res = await verifyCredentials(db, "ghost@pvcon.in", TEST_PASSWORD, { ...LOGIN, now: new Date() });
    expect(res).toEqual({ ok: false, reason: "invalid" });
  });

  it("locks after the configured failures and unlocks after the lock period", async () => {
    insertUser(db, { email: "b@pvcon.in" });
    const now = new Date("2026-09-24T10:00:00Z");
    await verifyCredentials(db, "b@pvcon.in", "wrong", { ...LOGIN, now });
    await verifyCredentials(db, "b@pvcon.in", "wrong", { ...LOGIN, now });
    const third = await verifyCredentials(db, "b@pvcon.in", "wrong", { ...LOGIN, now });
    expect(third).toMatchObject({ ok: false, reason: "locked" });
    const whileLocked = await verifyCredentials(db, "b@pvcon.in", TEST_PASSWORD, {
      ...LOGIN,
      now: new Date("2026-09-24T10:10:00Z"),
    });
    expect(whileLocked).toMatchObject({ ok: false, reason: "locked" });
    const afterLock = await verifyCredentials(db, "b@pvcon.in", TEST_PASSWORD, {
      ...LOGIN,
      now: new Date("2026-09-24T10:16:00Z"),
    });
    expect(afterLock.ok).toBe(true);
  });

  it("rejects disabled users", async () => {
    insertUser(db, { email: "d@pvcon.in", status: "disabled" });
    const res = await verifyCredentials(db, "d@pvcon.in", TEST_PASSWORD, { ...LOGIN, now: new Date() });
    expect(res).toMatchObject({ ok: false, reason: "disabled" });
  });

  it("rehashes passwords stored with a lower bcrypt cost", async () => {
    const u = insertUser(db, { email: "c@pvcon.in" });
    await verifyCredentials(db, "c@pvcon.in", TEST_PASSWORD, { ...LOGIN, cost: 5, now: new Date() });
    expect(bcrypt.getRounds(getUserById(db, u.id)!.passwordHash)).toBe(5);
  });
});

describe("sessions", () => {
  it("loads roles and permissions and rejects stale session versions", () => {
    const u = insertUser(db, { roles: ["employee", "manager"] });
    const session = loadSessionUser(db, u.id, u.sessionVersion)!;
    expect(session.roles).toEqual(["employee", "manager"]);
    expect(session.permissions).toContain("leave.approve");
    expect(loadSessionUser(db, u.id, u.sessionVersion + 1)).toBeNull();
    expect(loadSessionUser(db, 999, 1)).toBeNull();
  });
});

describe("passwords", () => {
  it("changes the password, clears the forced-change flag and bumps the session version", async () => {
    const u = insertUser(db, { mustChangePassword: true });
    const updated = await changePassword(db, u.id, TEST_PASSWORD, "NewPassw0rd!", POLICY, TEST_COST);
    expect(updated.mustChangePassword).toBe(false);
    expect(updated.sessionVersion).toBe(u.sessionVersion + 1);
    expect(bcrypt.compareSync("NewPassw0rd!", updated.passwordHash)).toBe(true);
  });

  it("rejects a wrong current password, weak passwords and unchanged passwords", async () => {
    const u = insertUser(db);
    await expect(changePassword(db, u.id, "nope", "NewPassw0rd!", POLICY, TEST_COST)).rejects.toMatchObject({
      code: "WRONG_PASSWORD",
    });
    await expect(changePassword(db, u.id, TEST_PASSWORD, "short", POLICY, TEST_COST)).rejects.toMatchObject({
      code: "WEAK_PASSWORD",
    });
    await expect(changePassword(db, u.id, TEST_PASSWORD, TEST_PASSWORD, POLICY, TEST_COST)).rejects.toMatchObject({
      code: "SAME_PASSWORD",
    });
  });

  it("generates policy-compliant temporary passwords", () => {
    for (let i = 0; i < 50; i++) {
      const p = generateTempPassword();
      expect(p).toHaveLength(14);
      expect(passwordProblems(p, POLICY)).toEqual([]);
    }
  });

  it("sets a temporary password that forces a change and revokes sessions", () => {
    const u = insertUser(db);
    db.update(users).set({ failedLoginCount: 2, lockedUntil: "2999-01-01T00:00:00.000Z" }).where(eq(users.id, u.id)).run();
    const updated = setTemporaryPassword(db, u.id, "hash");
    expect(updated.mustChangePassword).toBe(true);
    expect(updated.sessionVersion).toBe(u.sessionVersion + 1);
    expect(updated.lockedUntil).toBeNull();
  });
});

describe("password reset tokens", () => {
  it("resets a password with a valid token exactly once", async () => {
    const u = insertUser(db, { email: "r@pvcon.in" });
    const created = createPasswordResetToken(db, "r@pvcon.in", new Date("2026-09-24T10:00:00Z"))!;
    expect(created.token.length).toBeGreaterThan(30);
    const updated = await resetPasswordWithToken(
      db, created.token, "Brand-New-Pass1", POLICY, new Date("2026-09-24T10:10:00Z"), TEST_COST,
    );
    expect(updated.sessionVersion).toBe(u.sessionVersion + 1);
    await expect(
      resetPasswordWithToken(db, created.token, "Another-Pass12", POLICY, new Date("2026-09-24T10:11:00Z"), TEST_COST),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("rejects expired tokens and weak passwords", async () => {
    insertUser(db, { email: "e@pvcon.in" });
    const created = createPasswordResetToken(db, "e@pvcon.in", new Date("2026-09-24T10:00:00Z"))!;
    await expect(
      resetPasswordWithToken(db, created.token, "short", POLICY, new Date("2026-09-24T10:05:00Z"), TEST_COST),
    ).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    await expect(
      resetPasswordWithToken(db, created.token, "Brand-New-Pass1", POLICY, new Date("2026-09-24T10:31:00Z"), TEST_COST),
    ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("returns null for unknown or disabled users", () => {
    insertUser(db, { email: "x@pvcon.in", status: "disabled" });
    expect(createPasswordResetToken(db, "x@pvcon.in")).toBeNull();
    expect(createPasswordResetToken(db, "nobody@pvcon.in")).toBeNull();
  });
});

describe("user management", () => {
  it("rejects duplicate emails", () => {
    insertUser(db, { email: "dup@pvcon.in" });
    expectDomainError(
      () => createUser(db, { email: "DUP@pvcon.in", name: "Dup", roles: [], passwordHash: "x" }),
      "EMAIL_TAKEN",
    );
  });

  it("lets user.manage holders grant employee/manager only", () => {
    const hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
    const target = insertUser(db);
    expect(setUserRoles(db, hr, target.id, ["manager", "employee"]).after).toEqual(["employee", "manager"]);
    expectDomainError(() => setUserRoles(db, hr, target.id, ["employee", "payroll_admin"]), "FORBIDDEN_ROLE");
  });

  it("prevents self-demotion and removing the last super admin", () => {
    const root = insertUser(db, { roles: ["super_admin"] });
    const actor = sessionUserFor(db, root);
    expectDomainError(() => setUserRoles(db, actor, root.id, ["employee"]), "SELF_DEMOTE");

    const other = insertUser(db, { roles: ["super_admin"] });
    setUserRoles(db, actor, other.id, ["employee"]);
    expect(listUsers(db).find((u) => u.id === other.id)!.roles).toEqual(["employee"]);

    const phantom: SessionUser = {
      id: 999, email: "p@pvcon.in", name: "P", roles: ["super_admin"],
      permissions: permissionsForRoles(["super_admin"]), mustChangePassword: false,
    };
    expectDomainError(() => setUserRoles(db, phantom, root.id, ["employee"]), "LAST_SUPER_ADMIN");
  });

  it("disables users, revoking sessions, with guards", () => {
    const root = insertUser(db, { roles: ["super_admin"] });
    const actor = sessionUserFor(db, root);
    expectDomainError(() => setUserStatus(db, actor, root.id, "disabled"), "SELF_DISABLE");

    const target = insertUser(db);
    const disabled = setUserStatus(db, actor, target.id, "disabled");
    expect(disabled.status).toBe("disabled");
    expect(loadSessionUser(db, target.id, target.sessionVersion)).toBeNull();

    const hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
    expectDomainError(() => setUserStatus(db, hr, root.id, "disabled"), "FORBIDDEN_ROLE");
  });

  it("lists users with roles and without password hashes", () => {
    insertUser(db, { email: "l@pvcon.in", roles: ["employee", "manager"] });
    const row = listUsers(db).find((u) => u.email === "l@pvcon.in")!;
    expect(row.roles).toEqual(["employee", "manager"]);
    expect("passwordHash" in row).toBe(false);
  });
});
