import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { inlineFileUrl } from "@/lib/files";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { clockSnapshot } from "@/server/modules/clock/queries";
import { employeePhotoFileId } from "@/server/modules/employees/queries";
import { listNotifications, unreadCount } from "@/server/modules/notifications/service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");
  const recent = listNotifications(db, user.id, { limit: 8 }).map(({ id, title, body, link, readAt }) => ({
    id, title, body, link, readAt,
  }));
  const photoFileId = user.employeeId === null ? null : employeePhotoFileId(db, user.employeeId);
  return (
    <AppShell
      user={{
        name: user.name, email: user.email, photoUrl: photoFileId ? inlineFileUrl(photoFileId) : null, permissions: user.permissions,
        hasEmployee: user.employeeId !== null,
      }}
      unreadCount={unreadCount(db, user.id)}
      recentNotifications={recent}
      clock={user.employeeId === null ? null : clockSnapshot(db, user.employeeId, new Date())}
    >
      {children}
    </AppShell>
  );
}
