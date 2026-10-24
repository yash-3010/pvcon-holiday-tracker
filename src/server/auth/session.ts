import "server-only";
import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import { auth } from "@/auth";
import { can, canAny, type Permission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { db } from "@/server/db";
import { loadSessionUser } from "@/server/modules/users/service";

/** The DB-verified current user, or null (no session, disabled user, or revoked session). Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const id = Number(session?.user?.id);
  if (!session || !Number.isInteger(id) || id <= 0) return null;
  return loadSessionUser(db, id, session.user.sessionVersion);
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, permission)) forbidden();
  return user;
}

export async function requireAnyPermission(permissions: Permission[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAny(user, permissions)) forbidden();
  return user;
}
