import { and, asc, count, eq, gt, gte, inArray, lt, type SQL } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { notifications, users } from "@/server/db/schema";
import { isEmailConfigured, renderEmail, sendEmail } from "@/server/lib/email";
import { logger } from "@/server/lib/logger";

/** Emails older than this are no longer worth sending. */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

interface DeliveryOptions {
  now: Date;
  appUrl: string;
  limit?: number;
}

const linkTo = (appUrl: string, link: string | null) => `${appUrl}${link && link.startsWith("/") ? link : "/notifications"}`;

/**
 * Sends the email copies of pending notifications (spec §5.8). Rows are claimed before sending so two senders never
 * send one twice; a failed send goes back to pending, and the third failure gives up. Without SMTP, or for rows older
 * than three days, nothing is sent and the rows are skipped. Returns the number sent.
 */
export async function deliverNotificationEmails(db: DbLike, { now, appUrl, limit = 100 }: DeliveryOptions): Promise<number> {
  const cutoff = new Date(now.getTime() - MAX_AGE_MS).toISOString();
  db.update(notifications).set({ emailStatus: "skipped" }).where(and(eq(notifications.emailStatus, "pending"), lt(notifications.createdAt, cutoff))).run();
  if (!isEmailConfigured()) {
    db.update(notifications).set({ emailStatus: "skipped" }).where(eq(notifications.emailStatus, "pending")).run();
    return 0;
  }
  const ids = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.emailStatus, "pending"), gte(notifications.createdAt, cutoff)))
    .orderBy(asc(notifications.id))
    .limit(limit)
    .all()
    .map((r) => r.id);
  if (!ids.length) return 0;
  // Claim synchronously, before the first await, so a concurrent sender can't pick the same rows.
  const claimed = db
    .update(notifications)
    .set({ emailStatus: "sending" })
    .where(and(inArray(notifications.id, ids), eq(notifications.emailStatus, "pending")))
    .returning()
    .all();
  const emails = new Map(
    db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, [...new Set(claimed.map((n) => n.userId))])).all().map((u) => [u.id, u.email]),
  );

  let sent = 0;
  for (const n of claimed) {
    const to = emails.get(n.userId);
    if (!to) {
      db.update(notifications).set({ emailStatus: "skipped" }).where(eq(notifications.id, n.id)).run();
      continue;
    }
    const { html, text } = renderEmail({
      heading: n.title, paragraphs: n.body ? [n.body] : [], action: { label: "Open PVCON People", url: linkTo(appUrl, n.link) },
    });
    try {
      await sendEmail({ to, subject: n.title, html, text });
      db.update(notifications).set({ emailStatus: "sent", emailedAt: now.toISOString(), emailAttempts: n.emailAttempts + 1 }).where(eq(notifications.id, n.id)).run();
      sent += 1;
    } catch (err) {
      const attempts = n.emailAttempts + 1;
      logger.warn({ err, notificationId: n.id, attempts }, "notification email failed");
      db.update(notifications)
        .set({ emailStatus: attempts >= MAX_ATTEMPTS ? "skipped" : "pending", emailAttempts: attempts })
        .where(eq(notifications.id, n.id))
        .run();
    }
  }
  return sent;
}

/** The daily digest: one email per user listing their `digest` notifications. Returns the number of emails sent. */
export async function deliverDigests(db: DbLike, { now, appUrl }: DeliveryOptions): Promise<number> {
  if (!isEmailConfigured()) {
    db.update(notifications).set({ emailStatus: "skipped" }).where(eq(notifications.emailStatus, "digest")).run();
    return 0;
  }
  const claimed = db.update(notifications).set({ emailStatus: "sending" }).where(eq(notifications.emailStatus, "digest")).returning().all();
  const byUser = new Map<number, typeof claimed>();
  for (const n of claimed.sort((a, b) => a.id - b.id)) byUser.set(n.userId, [...(byUser.get(n.userId) ?? []), n]);
  const accounts = new Map(
    byUser.size
      ? db.select({ id: users.id, email: users.email, status: users.status }).from(users).where(inArray(users.id, [...byUser.keys()])).all().map((u) => [u.id, u])
      : [],
  );

  let sent = 0;
  for (const [userId, items] of byUser) {
    const ids = items.map((n) => n.id);
    const account = accounts.get(userId);
    if (!account || account.status !== "active") {
      db.update(notifications).set({ emailStatus: "skipped" }).where(inArray(notifications.id, ids)).run();
      continue;
    }
    const { html, text } = renderEmail({
      heading: "Your updates",
      paragraphs: items.map((n) => (n.body ? `${n.title}: ${n.body}` : n.title)),
      action: { label: "Open PVCON People", url: `${appUrl}/notifications` },
    });
    try {
      await sendEmail({ to: account.email, subject: `${items.length} update${items.length === 1 ? "" : "s"} from PVCON People`, html, text });
      db.update(notifications).set({ emailStatus: "sent", emailedAt: now.toISOString() }).where(inArray(notifications.id, ids)).run();
      sent += 1;
    } catch (err) {
      logger.warn({ err, userId }, "digest email failed");
      db.update(notifications).set({ emailStatus: "digest" }).where(inArray(notifications.id, ids)).run();
    }
  }
  return sent;
}

export interface OutboxCounts {
  /** Waiting for the 10-minute job, including retries. */
  pending: number;
  /** Waiting for the morning digest. */
  digest: number;
  sentLastDay: number;
  /** Given up on after three failed attempts, among the last day's notifications. */
  failedLastDay: number;
}

export function emailOutbox(db: DbLike, now: Date): OutboxCounts {
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const n = (where: SQL | undefined) => db.select({ n: count() }).from(notifications).where(where).get()?.n ?? 0;
  return {
    pending: n(inArray(notifications.emailStatus, ["pending", "sending"])),
    digest: n(eq(notifications.emailStatus, "digest")),
    sentLastDay: n(and(eq(notifications.emailStatus, "sent"), gte(notifications.emailedAt, dayAgo))),
    failedLastDay: n(and(eq(notifications.emailStatus, "skipped"), gt(notifications.emailAttempts, 0), gte(notifications.createdAt, dayAgo))),
  };
}
