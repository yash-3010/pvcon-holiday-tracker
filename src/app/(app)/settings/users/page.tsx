import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/dates";
import { requireAnyPermission } from "@/server/auth/session";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { getSetting } from "@/server/modules/settings/service";
import { listUsers } from "@/server/modules/users/service";
import { UsersTable, type UserRowView } from "./users-table";

export const metadata: Metadata = { title: "Users & roles" };

export default async function UsersPage() {
  const actor = await requireAnyPermission(["user.manage", "role.assign"]);
  const { timezone } = getSetting(db, "locale");
  const users: UserRowView[] = listUsers(db).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roles: u.roles,
    status: u.status,
    mustChangePassword: u.mustChangePassword,
    lastLoginLabel: u.lastLoginAt ? formatDateTime(u.lastLoginAt, timezone) : "Never",
  }));
  return (
    <>
      <PageHeader
        title="Users & roles"
        description="Sign-in accounts and what each person can access. Employee records are managed under Organization."
      />
      <UsersTable
        users={users}
        actorId={actor.id}
        canAssignPrivileged={can(actor, "role.assign")}
        allowedDomain={config.allowedEmailDomain}
      />
    </>
  );
}
