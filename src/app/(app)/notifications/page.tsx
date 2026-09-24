import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { listNotifications } from "@/server/modules/notifications/service";
import { getSetting } from "@/server/modules/settings/service";
import { MarkAllButton } from "./mark-all-button";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const { timezone } = getSetting(db, "locale");
  const items = listNotifications(db, user.id, { limit: 100 });
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Approvals, reminders and updates for you."
        actions={<MarkAllButton disabled={!items.some((n) => !n.readAt)} />}
      />
      {items.length === 0 ? (
        <EmptyState title="No notifications yet" description="You'll see approvals and updates here." />
      ) : (
        <Card className="divide-y">
          {items.map((n) => {
            const content = (
              <div className="flex items-start gap-3 px-5 py-4">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} />
                <div className="min-w-0 flex-1">
                  <p className={cn("text-sm", !n.readAt && "font-semibold")}>{n.title}</p>
                  {n.body && <p className="text-sm text-muted-foreground">{n.body}</p>}
                </div>
                <time className="shrink-0 text-xs text-muted-foreground">{formatDateTime(n.createdAt, timezone)}</time>
              </div>
            );
            return n.link ? (
              <Link key={n.id} href={n.link} className="block hover:bg-muted/50">
                {content}
              </Link>
            ) : (
              <div key={n.id}>{content}</div>
            );
          })}
        </Card>
      )}
    </>
  );
}
