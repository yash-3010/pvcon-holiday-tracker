import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import { notifications } from "@/server/db/schema";

export interface NewNotification {
  userId: number;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}

export function notify(db: DbLike, n: NewNotification): void {
  db.insert(notifications)
    .values({ userId: n.userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null })
    .run();
}

export function notifyMany(db: DbLike, userIds: number[], n: Omit<NewNotification, "userId">): void {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  db.insert(notifications)
    .values(unique.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null })))
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
