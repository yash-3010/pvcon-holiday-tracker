import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { listNotifications, unreadCount } from "@/server/modules/notifications/service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");
  const recent = listNotifications(db, user.id, { limit: 8 }).map(({ id, title, body, link, readAt }) => ({
    id, title, body, link, readAt,
  }));
  return (
    <AppShell
      user={{ name: user.name, email: user.email, permissions: user.permissions }}
      unreadCount={unreadCount(db, user.id)}
      recentNotifications={recent}
    >
      {children}
    </AppShell>
  );
}
