import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { dateInTimeZone, todayInTimeZone } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { allAnnouncements, currentAnnouncements } from "@/server/modules/announcements/queries";
import { getSetting } from "@/server/modules/settings/service";
import { AnnouncementsClient, type AnnouncementItem } from "./announcements-client";

export const metadata: Metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  const user = await requireUser();
  const now = new Date();
  const timeZone = getSetting(db, "locale").timezone;
  const manage = can(user, "announcement.manage");
  const rows = manage ? allAnnouncements(db, now) : currentAnnouncements(db, now).map((a) => ({ ...a, state: "live" as const }));
  const items: AnnouncementItem[] = rows.map((a) => ({
    id: a.id, title: a.title, body: a.body, pinned: a.pinned, state: a.state,
    publishOn: dateInTimeZone(new Date(a.publishAt), timeZone),
    // Stored as the exclusive end; the form shows the last day.
    showUntil: a.expiresAt ? dateInTimeZone(new Date(new Date(a.expiresAt).getTime() - 1), timeZone) : null,
  }));
  return (
    <>
      <PageHeader title="Announcements" description="News for everyone at PVCON." />
      <AnnouncementsClient items={items} canManage={manage} today={todayInTimeZone(timeZone, now)} />
    </>
  );
}
