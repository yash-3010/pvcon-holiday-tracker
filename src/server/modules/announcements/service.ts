import { and, eq, isNull, lte } from "drizzle-orm";
import { addDays, zonedInstant } from "@/lib/dates";
import type { AnnouncementInput } from "@/lib/validation/announcements";
import type { DbLike } from "@/server/db/client";
import { announcements, users, type AnnouncementRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { notifyMany } from "@/server/modules/notifications/service";

interface Clock {
  now: Date;
  timeZone: string;
}

export function requireAnnouncement(db: DbLike, id: number): AnnouncementRow {
  const row = db.select().from(announcements).where(eq(announcements.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Announcement not found.");
  return row;
}

/** The stored window: from the start of `publishOn` to the end of `showUntil`, in the company time zone. */
function window(input: AnnouncementInput, timeZone: string) {
  if (input.showUntil && input.showUntil < input.publishOn) {
    throw new DomainError("INVALID_DATES", "It can't end before it starts.", { showUntil: ["Before the start"] });
  }
  return {
    publishAt: zonedInstant(input.publishOn, 0, timeZone).toISOString(),
    expiresAt: input.showUntil ? zonedInstant(addDays(input.showUntil, 1), 0, timeZone).toISOString() : null,
  };
}

/** Notifies every active user once about each announcement whose time has come. Returns how many were published. */
export function publishDueAnnouncements(db: DbLike, now: Date): number {
  const due = db
    .select()
    .from(announcements)
    .where(and(isNull(announcements.notifiedAt), lte(announcements.publishAt, now.toISOString())))
    .all()
    .filter((a) => !a.expiresAt || a.expiresAt > now.toISOString());
  if (!due.length) return 0;
  const everyone = db.select({ id: users.id }).from(users).where(eq(users.status, "active")).all().map((u) => u.id);
  for (const a of due) {
    notifyMany(db, everyone, { type: "announcement.published", title: a.title, body: a.body.slice(0, 200), link: "/announcements" });
    db.update(announcements).set({ notifiedAt: now.toISOString() }).where(eq(announcements.id, a.id)).run();
  }
  return due.length;
}

export function createAnnouncement(db: DbLike, actorUserId: number, input: AnnouncementInput, { now, timeZone }: Clock): AnnouncementRow {
  const row = db
    .insert(announcements)
    .values({ title: input.title, body: input.body, pinned: input.pinned, ...window(input, timeZone), createdBy: actorUserId })
    .returning()
    .get();
  publishDueAnnouncements(db, now);
  return row;
}

/** Edits an announcement; one already announced isn't announced again. */
export function updateAnnouncement(
  db: DbLike,
  id: number,
  input: AnnouncementInput,
  { now, timeZone }: Clock,
): { before: AnnouncementRow; after: AnnouncementRow } {
  const before = requireAnnouncement(db, id);
  const after = db
    .update(announcements)
    .set({ title: input.title, body: input.body, pinned: input.pinned, ...window(input, timeZone) })
    .where(eq(announcements.id, id))
    .returning()
    .get()!;
  publishDueAnnouncements(db, now);
  return { before, after };
}

export function deleteAnnouncement(db: DbLike, id: number): AnnouncementRow {
  const row = requireAnnouncement(db, id);
  db.delete(announcements).where(eq(announcements.id, id)).run();
  return row;
}
