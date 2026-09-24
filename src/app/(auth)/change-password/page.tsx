import type { Metadata } from "next";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { getSetting } from "@/server/modules/settings/service";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Change password" };

export default async function ChangePasswordPage() {
  const user = await requireUser();
  const { passwordMinLength } = getSetting(db, "security");
  return <ChangePasswordForm forced={user.mustChangePassword} minLength={passwordMinLength} />;
}
