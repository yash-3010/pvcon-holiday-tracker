"use client";

import { Menu, Search } from "lucide-react";
import { TopbarClock } from "@/components/clock/topbar-clock";
import { Button } from "@/components/ui/button";
import { OPEN_COMMAND_PALETTE } from "./command-palette";
import { NotificationBell, type NotificationItem } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function Topbar({
  onMenu,
  name,
  email,
  photoUrl,
  unreadCount,
  recent,
}: {
  onMenu: () => void;
  name: string;
  email: string;
  photoUrl: string | null;
  unreadCount: number;
  recent: NotificationItem[];
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Menu />
      </Button>
      <button
        type="button"
        aria-label="Search"
        onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))}
        className="flex h-9 min-w-9 shrink items-center justify-center gap-2 rounded-md border border-input bg-card px-2.5 text-sm text-muted-foreground shadow-xs hover:bg-muted md:w-full md:max-w-sm md:justify-start md:px-3"
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden flex-1 text-left md:inline">Search…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 text-[10px] font-medium lg:inline">Ctrl K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <TopbarClock />
        <NotificationBell unreadCount={unreadCount} recent={recent} />
        <ThemeToggle />
        <UserMenu name={name} email={email} photoUrl={photoUrl} />
      </div>
    </header>
  );
}
