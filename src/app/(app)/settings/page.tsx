import { forbidden, redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { requireUser } from "@/server/auth/session";

export default async function SettingsIndex() {
  const user = await requireUser();
  if (can(user, "settings.manage")) redirect("/settings/company");
  if (can(user, "user.manage") || can(user, "role.assign")) redirect("/settings/users");
  if (can(user, "audit.view")) redirect("/settings/audit");
  forbidden();
}
