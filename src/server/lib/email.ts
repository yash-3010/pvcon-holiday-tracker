import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

let transporter: Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function getTransporter(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/** Sends via SMTP; when SMTP is not configured it logs and returns `{ sent: false }`. */
export async function sendEmail(message: EmailMessage): Promise<{ sent: boolean }> {
  if (!isEmailConfigured()) {
    logger.info({ to: message.to, subject: message.subject }, "SMTP not configured; email skipped");
    return { sent: false };
  }
  await getTransporter().sendMail({ from: process.env.SMTP_FROM, ...message });
  return { sent: true };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailContent {
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
}

/** Brand-styled transactional email (navy #202f63) with a plain-text alternative. */
export function renderEmail({ heading, paragraphs, action }: EmailContent): { html: string; text: string } {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6;color:#374151">${escapeHtml(p)}</p>`)
    .join("");
  const button = action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(action.url)}" style="background:#202f63;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px">
<tr><td>
<p style="margin:0 0 24px;font-weight:700;color:#202f63;font-size:18px">PVCON People</p>
<h1 style="margin:0 0 16px;font-size:20px;color:#111827">${escapeHtml(heading)}</h1>
${body}${button}
<p style="margin:24px 0 0;font-size:12px;color:#6b7280">This is an automated message from PVCON People.</p>
</td></tr></table></td></tr></table></body></html>`;
  const text = [heading, "", ...paragraphs, ...(action ? ["", `${action.label}: ${action.url}`] : [])].join("\n");
  return { html, text };
}
