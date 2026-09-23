import bcrypt from "bcryptjs";
import { and, asc, eq, isNull } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { passwordProblems, type PasswordPolicy } from "@/lib/auth/password-policy";
import { can, isPrivilegedRole, permissionsForRoles, type Role } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DbLike } from "@/server/db/client";
import { passwordResetTokens, userRoles, users, type UserRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { randomToken, sha256Hex } from "@/server/lib/crypto";

export const BCRYPT_COST = 12;

export function hashPassword(password: string, cost = BCRYPT_COST): Promise<string> {
  return bcrypt.hash(password, cost);
}

let dummyHash: string | undefined;
function getDummyHash(): string {
  return (dummyHash ??= bcrypt.hashSync("timing-equalizer-not-a-password", 10));
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function findUserByEmail(db: DbLike, email: string): UserRow | undefined {
  return db.select().from(users).where(eq(users.email, normalizeEmail(email))).get();
}

export function getUserById(db: DbLike, id: number): UserRow | undefined {
  return db.select().from(users).where(eq(users.id, id)).get();
}

export function getUserRoles(db: DbLike, userId: number): Role[] {
  return db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, userId))
    .orderBy(asc(userRoles.role))
    .all()
    .map((r) => r.role);
}

/** Resolves the session user, or null when the user is gone, disabled, or the session was revoked. */
export function loadSessionUser(db: DbLike, userId: number, sessionVersion: number | undefined): SessionUser | null {
  const user = getUserById(db, userId);
  if (!user || user.status !== "active" || user.sessionVersion !== sessionVersion) return null;
  const roles = getUserRoles(db, userId);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles,
    permissions: permissionsForRoles(roles),
    mustChangePassword: user.mustChangePassword,
  };
}

export type LoginResult =
  | { ok: true; user: UserRow }
  | { ok: false; reason: "invalid" | "locked" | "disabled"; userId?: number };

export interface LoginOptions {
  now: Date;
  lockoutAttempts: number;
  lockoutMinutes: number;
  cost?: number;
}

export async function verifyCredentials(
  db: DbLike,
  email: string,
  password: string,
  opts: LoginOptions,
): Promise<LoginResult> {
  const user = findUserByEmail(db, email);
  if (!user) {
    await bcrypt.compare(password, getDummyHash());
    return { ok: false, reason: "invalid" };
  }
  if (user.status !== "active") return { ok: false, reason: "disabled", userId: user.id };
  const nowIso = opts.now.toISOString();
  if (user.lockedUntil && user.lockedUntil > nowIso) return { ok: false, reason: "locked", userId: user.id };

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= opts.lockoutAttempts;
    db.update(users)
      .set({
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(opts.now.getTime() + opts.lockoutMinutes * 60_000).toISOString() : user.lockedUntil,
      })
      .where(eq(users.id, user.id))
      .run();
    return { ok: false, reason: lock ? "locked" : "invalid", userId: user.id };
  }

  const cost = opts.cost ?? BCRYPT_COST;
  const patch: Partial<typeof users.$inferInsert> = { failedLoginCount: 0, lockedUntil: null, lastLoginAt: nowIso };
  if (bcrypt.getRounds(user.passwordHash) < cost) patch.passwordHash = await bcrypt.hash(password, cost);
  const updated = db.update(users).set(patch).where(eq(users.id, user.id)).returning().get()!;
  return { ok: true, user: updated };
}

export interface CreateUserInput {
  email: string;
  name: string;
  roles: Role[];
  passwordHash: string;
  mustChangePassword?: boolean;
}

export function createUser(db: DbLike, input: CreateUserInput): UserRow {
  const email = normalizeEmail(input.email);
  if (findUserByEmail(db, email)) {
    throw new DomainError("EMAIL_TAKEN", "A user with this email already exists.", { email: ["Already in use"] });
  }
  const user = db
    .insert(users)
    .values({
      email,
      name: input.name.trim(),
      passwordHash: input.passwordHash,
      mustChangePassword: input.mustChangePassword ?? true,
    })
    .returning()
    .get();
  const roles = [...new Set(input.roles)];
  if (roles.length) db.insert(userRoles).values(roles.map((role) => ({ userId: user.id, role }))).run();
  return user;
}

export function assertCanGrantRoles(actor: Pick<SessionUser, "permissions">, roles: readonly Role[]): void {
  if (roles.some(isPrivilegedRole) && !can(actor, "role.assign")) {
    throw new DomainError("FORBIDDEN_ROLE", "Only a super admin can grant or revoke HR, payroll or super admin roles.");
  }
}

function otherActiveSuperAdmins(db: DbLike, excludingUserId: number): number {
  return db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.role, "super_admin"), eq(users.status, "active")))
    .all()
    .filter((r) => r.id !== excludingUserId).length;
}

export function setUserRoles(
  db: DbLike,
  actor: SessionUser,
  userId: number,
  roles: Role[],
): { before: Role[]; after: Role[] } {
  const target = getUserById(db, userId);
  if (!target) throw new DomainError("NOT_FOUND", "User not found.");
  const before = getUserRoles(db, userId);
  const after = [...new Set(roles)].sort() as Role[];
  const added = after.filter((r) => !before.includes(r));
  const removed = before.filter((r) => !after.includes(r));
  assertCanGrantRoles(actor, [...added, ...removed]);
  if (removed.includes("super_admin")) {
    if (userId === actor.id) throw new DomainError("SELF_DEMOTE", "You cannot remove your own super admin role.");
    if (target.status === "active" && otherActiveSuperAdmins(db, userId) === 0) {
      throw new DomainError("LAST_SUPER_ADMIN", "At least one active super admin must remain.");
    }
  }
  db.delete(userRoles).where(eq(userRoles.userId, userId)).run();
  if (after.length) db.insert(userRoles).values(after.map((role) => ({ userId, role }))).run();
  return { before, after };
}

export function setUserStatus(
  db: DbLike,
  actor: SessionUser,
  userId: number,
  status: "active" | "disabled",
): UserRow {
  const target = getUserById(db, userId);
  if (!target) throw new DomainError("NOT_FOUND", "User not found.");
  const roles = getUserRoles(db, userId);
  assertCanGrantRoles(actor, roles);
  if (status === "disabled") {
    if (userId === actor.id) throw new DomainError("SELF_DISABLE", "You cannot disable your own account.");
    if (roles.includes("super_admin") && otherActiveSuperAdmins(db, userId) === 0) {
      throw new DomainError("LAST_SUPER_ADMIN", "At least one active super admin must remain.");
    }
  }
  return db
    .update(users)
    .set({
      status,
      sessionVersion: status === "disabled" ? target.sessionVersion + 1 : target.sessionVersion,
      failedLoginCount: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, userId))
    .returning()
    .get()!;
}

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";

/** Random, unambiguous temporary password containing upper, lower and digit characters. */
export function generateTempPassword(length = 14): string {
  const all = UPPER + LOWER + DIGITS;
  const pick = (chars: string) => chars[randomInt(chars.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Admin reset: stores a (pre-hashed) temporary password, forces a change, unlocks and revokes sessions. */
export function setTemporaryPassword(db: DbLike, userId: number, passwordHash: string): UserRow {
  const target = getUserById(db, userId);
  if (!target) throw new DomainError("NOT_FOUND", "User not found.");
  return db
    .update(users)
    .set({
      passwordHash,
      mustChangePassword: true,
      sessionVersion: target.sessionVersion + 1,
      failedLoginCount: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, userId))
    .returning()
    .get()!;
}

function assertStrongPassword(password: string, policy: PasswordPolicy): void {
  const problems = passwordProblems(password, policy);
  if (problems.length) {
    throw new DomainError("WEAK_PASSWORD", `Password needs: ${problems.join(", ")}.`, { password: problems });
  }
}

export async function changePassword(
  db: DbLike,
  userId: number,
  currentPassword: string,
  newPassword: string,
  policy: PasswordPolicy,
  cost = BCRYPT_COST,
): Promise<UserRow> {
  const user = getUserById(db, userId);
  if (!user) throw new DomainError("NOT_FOUND", "User not found.");
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new DomainError("WRONG_PASSWORD", "Current password is incorrect.", { currentPassword: ["Incorrect"] });
  }
  assertStrongPassword(newPassword, policy);
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw new DomainError("SAME_PASSWORD", "Choose a password different from the current one.");
  }
  const passwordHash = await bcrypt.hash(newPassword, cost);
  return db
    .update(users)
    .set({
      passwordHash,
      mustChangePassword: false,
      sessionVersion: user.sessionVersion + 1,
      failedLoginCount: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, userId))
    .returning()
    .get()!;
}

export function createPasswordResetToken(
  db: DbLike,
  email: string,
  now: Date = new Date(),
  ttlMinutes = 30,
): { user: UserRow; token: string } | null {
  const user = findUserByEmail(db, email);
  if (!user || user.status !== "active") return null;
  const token = randomToken(32);
  db.insert(passwordResetTokens)
    .values({
      userId: user.id,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
    })
    .run();
  return { user, token };
}

export async function resetPasswordWithToken(
  db: DbLike,
  token: string,
  newPassword: string,
  policy: PasswordPolicy,
  now: Date = new Date(),
  cost = BCRYPT_COST,
): Promise<UserRow> {
  const invalid = new DomainError("INVALID_TOKEN", "This reset link is invalid or has expired.");
  const nowIso = now.toISOString();
  const row = db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, sha256Hex(token)))
    .get();
  if (!row || row.usedAt || row.expiresAt <= nowIso) throw invalid;
  const user = getUserById(db, row.userId);
  if (!user || user.status !== "active") throw invalid;
  assertStrongPassword(newPassword, policy);
  const passwordHash = await bcrypt.hash(newPassword, cost);
  return db.transaction((tx) => {
    tx.update(passwordResetTokens)
      .set({ usedAt: nowIso })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)))
      .run();
    return tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
        sessionVersion: user.sessionVersion + 1,
        failedLoginCount: 0,
        lockedUntil: null,
      })
      .where(eq(users.id, user.id))
      .returning()
      .get()!;
  });
}

export type UserListItem = Omit<UserRow, "passwordHash"> & { roles: Role[] };

export function listUsers(db: DbLike): UserListItem[] {
  const rows = db.select().from(users).orderBy(asc(users.name)).all();
  const roleRows = db.select().from(userRoles).all();
  return rows.map((row) => {
    const { passwordHash, ...rest } = row;
    void passwordHash;
    return {
      ...rest,
      roles: roleRows
        .filter((r) => r.userId === rest.id)
        .map((r) => r.role)
        .sort(),
    };
  });
}
