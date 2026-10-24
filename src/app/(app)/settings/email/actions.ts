"use server";

import { z } from "zod";
import { defineAction } from "@/server/actions/define";
import { DomainError } from "@/server/errors";
import { isEmailConfigured, renderEmail, sendEmail } from "@/server/lib/email";

/** Sends a test email to the administrator's own address, so they can check the SMTP settings (spec §5.11). */
export const sendTestEmailAction = defineAction({
  name: "settings.email.test",
  schema: z.object({}),
  permission: "settings.manage",
  prepare: async (_input, user) => {
    if (!isEmailConfigured()) throw new DomainError("SMTP_NOT_CONFIGURED", "Email isn't set up: SMTP_HOST and SMTP_FROM are empty on the server.");
    const { html, text } = renderEmail({
      heading: "Test email",
      paragraphs: [`Hello ${user.name}, this test from PVCON People shows that the server can send email.`],
    });
    try {
      await sendEmail({ to: user.email, subject: "PVCON People test email", html, text });
    } catch (err) {
      throw new DomainError("SEND_FAILED", `The mail server didn't take the email: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
  handler: ({ user, audit }) => {
    audit({ action: "settings.email_test", entityType: "settings", entityId: "email", summary: `Sent a test email to ${user.email}` });
    return { to: user.email };
  },
});
