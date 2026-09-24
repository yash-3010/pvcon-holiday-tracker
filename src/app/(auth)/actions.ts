"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { isAllowedEmail } from "@/lib/auth/email-domain";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { getCurrentUser } from "@/server/auth/session";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { isEmailConfigured, renderEmail, sendEmail } from "@/server/lib/email";
import { logger } from "@/server/lib/logger";
import { createRateLimiter } from "@/server/lib/rate-limit";
import { clientIp } from "@/server/lib/request";
import { writeAudit } from "@/server/modules/audit/service";
import { getSetting } from "@/server/modules/settings/service";
import { changePassword, createPasswordResetToken, resetPasswordWithToken } from "@/server/modules/users/service";

export interface AuthFormState {
  error?: string;
  message?: string;
  email?: string;
  fieldErrors?: Record<string, string[]>;
}

const LOGIN_ERRORS: Record<string, string> = {
  invalid: "Incorrect email or password.",
  locked: "Too many failed attempts. Your account is locked for a few minutes.",
  rate_limited: "Too many sign-in attempts from this network. Please wait and try again.",
};

const forgotLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 5 });

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "");
  try {
    await signIn("credentials", {
      email,
      password: String(formData.get("password") ?? ""),
      redirectTo: safeRedirectPath(formData.get("next")),
    });
    return {};
  } catch (err) {
    if (err instanceof CredentialsSignin) return { email, error: LOGIN_ERRORS[err.code] ?? LOGIN_ERRORS.invalid };
    if (err instanceof AuthError) return { email, error: LOGIN_ERRORS.invalid };
    throw err; // NEXT_REDIRECT on success
  }
}

export async function changePasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (newPassword !== confirmPassword) return { fieldErrors: { confirmPassword: ["Passwords do not match."] } };

  const { passwordMinLength } = getSetting(db, "security");
  try {
    await changePassword(db, user.id, currentPassword, newPassword, { minLength: passwordMinLength });
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message, fieldErrors: err.fieldErrors };
    throw err;
  }
  const h = await headers();
  writeAudit(db, {
    actorUserId: user.id,
    action: "user.password_changed",
    entityType: "user",
    entityId: user.id,
    summary: "Changed own password",
    ip: clientIp(h),
    userAgent: h.get("user-agent"),
  });
  // The password change revoked every session; sign this browser back in with the new password.
  await signIn("credentials", { email: user.email, password: newPassword, redirectTo: "/" });
  return {};
}

export async function forgotPasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const h = await headers();
  const ip = clientIp(h) ?? "unknown";
  if (!forgotLimiter.check(ip)) return { error: "Too many requests. Please try again later." };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const generic: AuthFormState = {
    message: "If an account exists for that email, a reset link is on its way. It expires in 30 minutes.",
  };
  if (!isAllowedEmail(email, config.allowedEmailDomain)) return generic;
  if (!isEmailConfigured()) {
    logger.warn({ email }, "password reset requested but SMTP is not configured");
    return { message: "Email delivery isn't set up yet. Ask an administrator to reset your password." };
  }

  const created = createPasswordResetToken(db, email);
  if (created) {
    const { html, text } = renderEmail({
      heading: "Reset your password",
      paragraphs: [
        `Hi ${created.user.name},`,
        "We received a request to reset your PVCON People password. The link below expires in 30 minutes.",
        "If you didn't ask for this, you can ignore this email.",
      ],
      action: { label: "Reset password", url: `${config.appUrl}/reset-password/${created.token}` },
    });
    try {
      await sendEmail({ to: created.user.email, subject: "Reset your PVCON People password", html, text });
    } catch (err) {
      logger.error({ err }, "failed to send password reset email");
    }
    writeAudit(db, {
      actorUserId: created.user.id,
      action: "auth.reset_requested",
      entityType: "user",
      entityId: created.user.id,
      summary: "Requested a password reset",
      ip,
      userAgent: h.get("user-agent"),
    });
  }
  return generic;
}

export async function resetPasswordAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const token = String(formData.get("token") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  if (newPassword !== confirmPassword) return { fieldErrors: { confirmPassword: ["Passwords do not match."] } };

  const { passwordMinLength } = getSetting(db, "security");
  let userId: number;
  try {
    userId = (await resetPasswordWithToken(db, token, newPassword, { minLength: passwordMinLength })).id;
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }
  const h = await headers();
  writeAudit(db, {
    actorUserId: userId,
    action: "auth.password_reset",
    entityType: "user",
    entityId: userId,
    summary: "Reset password with an emailed link",
    ip: clientIp(h),
    userAgent: h.get("user-agent"),
  });
  redirect("/login?reset=1");
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
