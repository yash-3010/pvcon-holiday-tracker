/** How notifications reach a user by email (spec §5.8). Sign-in, password and payslip emails are always sent. */
export const EMAIL_MODES = ["instant", "digest", "off"] as const;
export type EmailMode = (typeof EMAIL_MODES)[number];
export const EMAIL_MODE_LABELS: Record<EmailMode, { label: string; description: string }> = {
  instant: { label: "As they happen", description: "An email for each notification, within a few minutes." },
  digest: { label: "Daily digest", description: "One email each morning with the day's updates." },
  off: { label: "Off", description: "Only in the app. Password and payslip emails still arrive." },
};
