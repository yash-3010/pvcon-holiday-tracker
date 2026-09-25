"use server";

import { isAllowedEmail } from "@/lib/auth/email-domain";
import { can, type Permission } from "@/lib/auth/permissions";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { defineAction } from "@/server/actions/define";
import { config } from "@/server/config";
import { DomainError } from "@/server/errors";
import { createEmployee, type LoginPlan } from "@/server/modules/employees/service";
import { generateTempPassword, hashPassword } from "@/server/modules/users/service";

const canManageLogins = (user: { permissions: readonly Permission[] }) => can(user, "user.manage") || can(user, "role.assign");

async function temporaryPassword() {
  const password = generateTempPassword();
  return { password, hash: await hashPassword(password) };
}

function assertLoginDomain(email: string | null): void {
  if (email && !isAllowedEmail(email, config.allowedEmailDomain)) {
    throw new DomainError("EMAIL_DOMAIN", `Logins need an @${config.allowedEmailDomain} work email.`, {
      workEmail: [`Must be an @${config.allowedEmailDomain} address`],
    });
  }
}

export const createEmployeeAction = defineAction({
  name: "employees.create",
  schema: createEmployeeSchema,
  permission: (user, input) => can(user, "employee.create") && (input.loginMode === "none" || canManageLogins(user)),
  prepare: async (input) => (input.loginMode === "create" ? temporaryPassword() : null),
  handler: ({ tx, user, audit }, input, temp) => {
    const { loginMode, loginRoles, linkUserId, ...employee } = input;
    if (loginMode === "create") assertLoginDomain(employee.workEmail);
    const login: LoginPlan =
      loginMode === "create"
        ? { mode: "create", roles: loginRoles, passwordHash: temp!.hash }
        : loginMode === "link"
          ? { mode: "link", userId: linkUserId! }
          : { mode: "none" };
    const row = createEmployee(tx, user, employee, { login, onboarding: true });
    const loginNote = { none: "", create: " with a new login", link: " linked to an existing login" }[loginMode];
    audit({
      action: "employee.create", entityType: "employee", entityId: row.id,
      summary: `Added ${row.employeeCode} ${row.displayName}${loginNote}`,
    });
    return {
      id: row.id,
      employeeCode: row.employeeCode,
      tempPassword: loginMode === "create" ? temp!.password : null,
      loginEmail: loginMode === "create" ? row.workEmail : null,
    };
  },
  revalidate: ["/org/employees"],
});
