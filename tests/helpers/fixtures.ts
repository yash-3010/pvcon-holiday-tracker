import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import type { Role } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DbLike } from "@/server/db/client";
import { users, type UserRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createUser, getUserById, loadSessionUser } from "@/server/modules/users/service";

export const TEST_COST = 4;
export const TEST_PASSWORD = "Passw0rd!Good";
let seq = 0;

export function insertUser(
  db: DbLike,
  opts: {
    email?: string;
    name?: string;
    password?: string;
    roles?: Role[];
    status?: "active" | "disabled";
    mustChangePassword?: boolean;
  } = {},
): UserRow {
  const created = createUser(db, {
    email: opts.email ?? `user${++seq}@pvcon.in`,
    name: opts.name ?? "Test User",
    roles: opts.roles ?? ["employee"],
    passwordHash: bcrypt.hashSync(opts.password ?? TEST_PASSWORD, TEST_COST),
    mustChangePassword: opts.mustChangePassword ?? false,
  });
  if (opts.status === "disabled") {
    db.update(users).set({ status: "disabled" }).where(eq(users.id, created.id)).run();
  }
  return getUserById(db, created.id)!;
}

export function sessionUserFor(db: DbLike, user: UserRow): SessionUser {
  const loaded = loadSessionUser(db, user.id, getUserById(db, user.id)!.sessionVersion);
  if (!loaded) throw new Error(`User ${user.id} has no active session`);
  return loaded;
}

export function expectDomainError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe(code);
    return;
  }
  throw new Error(`Expected DomainError ${code}, but nothing was thrown`);
}
