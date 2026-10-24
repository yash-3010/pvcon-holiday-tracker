import { and, desc, gt, isNull, lte, or } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { announcements, type AnnouncementRow } from "@/server/db/schema";

/** What everyone sees now: published, not expired, pinned first, newest first. */
export function currentAnnouncements(db: DbLike, now: Date, { limit }: { limit?: number } = {}): AnnouncementRow[] {
  const at = now.toISOString();
  const query = db
    .select()
    .from(announcements)
    .where(and(lte(announcements.publishAt, at), or(isNull(announcements.expiresAt), gt(announcements.expiresAt, at))))
    .orderBy(desc(announcements.pinned), desc(announcements.publishAt), desc(announcements.id));
  return limit ? query.limit(limit).all() : query.all();
}

export type AnnouncementState = "scheduled" | "live" | "expired";

/** Every announcement with its state, newest first, for people who manage them. */
export function allAnnouncements(db: DbLike, now: Date): (AnnouncementRow & { state: AnnouncementState })[] {
  const at = now.toISOString();
  return db
    .select()
    .from(announcements)
    .orderBy(desc(announcements.publishAt), desc(announcements.id))
    .all()
    .map((a) => ({ ...a, state: a.publishAt > at ? "scheduled" : a.expiresAt && a.expiresAt <= at ? "expired" : "live" }));
}
