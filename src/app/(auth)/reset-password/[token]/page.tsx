import type { Metadata } from "next";
import { db } from "@/server/db";
import { getSetting } from "@/server/modules/settings/service";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { passwordMinLength } = getSetting(db, "security");
  return <ResetPasswordForm token={token} minLength={passwordMinLength} />;
}
