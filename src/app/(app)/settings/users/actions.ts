"use server";

import { z } from "zod";
import { isAllowedEmail } from "@/lib/auth/email-domain";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { createUserSchema, rolesSchema } from "@/lib/validation/users";
import { defineAction } from "@/server/actions/define";
import { config } from "@/server/config";
import { DomainError } from "@/server/errors";
import {
  assertCanGrantRoles, createUser, generateTempPassword, getUserById, getUserRoles, hashPassword,
  setTemporaryPassword, setUserRoles, setUserStatus,
} from "@/server/modules/users/service";

const canManageUsers = (user: SessionUser) => can(user, "user.manage") || can(user, "role.assign");

async function tempPassword() {
  const password = generateTempPassword();
  return { password, hash: await hashPassword(password) };
}

export const createUserAction = defineAction({
  name: "users.create",
  schema: createUserSchema,
  permission: canManageUsers,
  prepare: tempPassword,
  handler: ({ tx, user, audit }, input, temp) => {
    if (!isAllowedEmail(input.email, config.allowedEmailDomain)) {
      throw new DomainError("EMAIL_DOMAIN", `Use an @${config.allowedEmailDomain} address.`, {
        email: [`Must be an @${config.allowedEmailDomain} address`],
      });
    }
    assertCanGrantRoles(user, input.roles);
    const created = createUser(tx, {
      email: input.email,
      name: input.name,
      roles: input.roles,
      passwordHash: temp.hash,
      mustChangePassword: true,
    });
    audit({
      action: "user.create",
      entityType: "user",
      entityId: created.id,
      summary: `Created user ${created.email}`,
      diff: { roles: { from: null, to: input.roles } },
    });
    return { userId: created.id, email: created.email, tempPassword: temp.password };
  },
  revalidate: ["/settings/users"],
});

export const updateUserRolesAction = defineAction({
  name: "users.roles",
  schema: z.object({ userId: z.number().int().positive(), roles: rolesSchema }),
  permission: canManageUsers,
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = setUserRoles(tx, user, input.userId, input.roles);
    audit({ action: "user.roles", entityType: "user", entityId: input.userId, summary: "Changed roles", diff: { roles: { from: before, to: after } } });
    return { roles: after };
  },
  revalidate: ["/settings/users"],
});

export const resetUserPasswordAction = defineAction({
  name: "users.reset_password",
  schema: z.object({ userId: z.number().int().positive() }),
  permission: canManageUsers,
  prepare: tempPassword,
  handler: ({ tx, user, audit }, input, temp) => {
    const target = getUserById(tx, input.userId);
    if (!target) throw new DomainError("NOT_FOUND", "User not found.");
    assertCanGrantRoles(user, getUserRoles(tx, input.userId));
    setTemporaryPassword(tx, input.userId, temp.hash);
    audit({ action: "user.password_reset", entityType: "user", entityId: input.userId, summary: `Reset password for ${target.email}` });
    return { email: target.email, tempPassword: temp.password };
  },
  revalidate: ["/settings/users"],
});

export const setUserStatusAction = defineAction({
  name: "users.status",
  schema: z.object({ userId: z.number().int().positive(), status: z.enum(["active", "disabled"]) }),
  permission: canManageUsers,
  handler: ({ tx, user, audit }, input) => {
    const updated = setUserStatus(tx, user, input.userId, input.status);
    audit({
      action: input.status === "disabled" ? "user.disable" : "user.enable",
      entityType: "user",
      entityId: input.userId,
      summary: `${input.status === "disabled" ? "Disabled" : "Enabled"} ${updated.email}`,
    });
    return { status: updated.status };
  },
  revalidate: ["/settings/users"],
});
