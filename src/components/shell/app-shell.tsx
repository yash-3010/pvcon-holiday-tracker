"use client";

import { useState } from "react";
import { ClockProvider } from "@/components/clock/clock-provider";
import { PopOutProvider } from "@/components/clock/pop-out";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import type { Permission } from "@/lib/auth/permissions";
import type { ClockSnapshot } from "@/server/modules/clock/queries";
import { CommandPalette } from "./command-palette";
import type { NotificationItem } from "./notification-bell";
import { SidebarNav } from "./sidebar-nav";
import { Topbar } from "./topbar";

export function AppShell({
  user,
  unreadCount,
  recentNotifications,
  clock,
  children,
}: {
  user: { name: string; email: string; photoUrl: string | null; permissions: Permission[]; hasEmployee: boolean };
  unreadCount: number;
  recentNotifications: NotificationItem[];
  /** The work clock, for logins with an employee record. */
  clock: ClockSnapshot | null;
  children: React.ReactNode;
}) {
  const shell = <Shell user={user} unreadCount={unreadCount} recentNotifications={recentNotifications}>{children}</Shell>;
  return clock ? (
    <ClockProvider initial={clock}>
      <PopOutProvider>{shell}</PopOutProvider>
    </ClockProvider>
  ) : (
    shell
  );
}

function Shell({
  user,
  unreadCount,
  recentNotifications,
  children,
}: {
  user: { name: string; email: string; photoUrl: string | null; permissions: Permission[]; hasEmployee: boolean };
  unreadCount: number;
  recentNotifications: NotificationItem[];
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r bg-sidebar lg:block">
        <SidebarNav permissions={user.permissions} hasEmployee={user.hasEmployee} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarNav permissions={user.permissions} hasEmployee={user.hasEmployee} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onMenu={() => setMobileOpen(true)}
          name={user.name}
          email={user.email}
          photoUrl={user.photoUrl}
          unreadCount={unreadCount}
          recent={recentNotifications}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
      <CommandPalette permissions={user.permissions} hasEmployee={user.hasEmployee} />
    </div>
  );
}
