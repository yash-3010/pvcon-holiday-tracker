import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { EmailMode } from "@/lib/notifications";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import { EMAIL_STATUSES, notifications, users } from "@/server/db/schema";

export interface NewNotification {
  userId: number;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

/** Notifications that send their own email (with attachments), so the outbox leaves them alone. */
const SELF_EMAILED = new Set(["payslip.released"]);

/** What happens to the email copy of each user's notification, from their email mode (spec §5.8). */
function emailStatuses(db: DbLike, userIds: number[], type: string): Map<number, (typeof EMAIL_STATUSES)[number]> {
  const rows = userIds.length
    ? db.select({ id: users.id, status: users.status, mode: users.emailMode }).from(users).where(inArray(users.id, userIds)).all()
    : [];
  return new Map(
    rows.map((u) => [
      u.id,
      SELF_EMAILED.has(type) || u.status !== "active" || u.mode === "off" ? "skipped" : u.mode === "digest" ? "digest" : "pending",
    ]),
  );
}

export function notify(db: DbLike, n: NewNotification): void {
  notifyMany(db, [n.userId], n);
}

export function notifyMany(db: DbLike, userIds: number[], n: Omit<NewNotification, "userId">): void {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  const email = emailStatuses(db, unique, n.type);
  db.insert(notifications)
    .values(
      unique.map((userId) => ({
        userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null, emailStatus: email.get(userId) ?? "skipped",
      })),
    )
    .run();
}

export function listNotifications(
  db: DbLike,
  userId: number,
  { limit = 20, unreadOnly = false }: { limit?: number; unreadOnly?: boolean } = {},
) {
  const where = unreadOnly
    ? and(eq(notifications.userId, userId), isNull(notifications.readAt))
    : eq(notifications.userId, userId);
  return db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit)
    .all();
}

export function unreadCount(db: DbLike, userId: number): number {
  return (
    db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .get()?.n ?? 0
  );
}

/** Returns the number of notifications marked read. Never touches other users' rows. */
export function markRead(db: DbLike, userId: number, ids: number[] | "all", now: string = nowIso()): number {
  const base = and(eq(notifications.userId, userId), isNull(notifications.readAt));
  const where = ids === "all" ? base : and(base, inArray(notifications.id, ids.length ? ids : [-1]));
  return db.update(notifications).set({ readAt: now }).where(where).run().changes;
}

export function emailModeOf(db: DbLike, userId: number): EmailMode {
  return db.select({ mode: users.emailMode }).from(users).where(eq(users.id, userId)).get()?.mode ?? "instant";
}

/**
 * Saves a user's email mode and moves their unsent email copies with it: instant ones join the digest, digest ones
 * go out at once, and turning email off drops both.
 */
export function setEmailMode(db: DbLike, userId: number, mode: EmailMode): { before: EmailMode; after: EmailMode } {
  const before = emailModeOf(db, userId);
  db.update(users).set({ emailMode: mode }).where(eq(users.id, userId)).run();
  const waiting = inArray(notifications.emailStatus, ["pending", "digest"]);
  const status = mode === "off" ? "skipped" : mode === "digest" ? "digest" : "pending";
  db.update(notifications).set({ emailStatus: status }).where(and(eq(notifications.userId, userId), waiting)).run();
  return { before, after: mode };
}
