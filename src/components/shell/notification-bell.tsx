"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Bell } from "lucide-react";
import { markNotificationsRead } from "@/app/(app)/notifications/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface NotificationItem {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
}

export function NotificationBell({ unreadCount, recent }: { unreadCount: number; recent: NotificationItem[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const open = (n: NotificationItem) =>
    startTransition(async () => {
      if (!n.readAt) await markNotificationsRead({ ids: [n.id] });
      router.push(n.link ?? "/notifications");
      router.refresh();
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unreadCount ? `Notifications (${unreadCount} unread)` : "Notifications"}
        >
          <Bell />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unreadCount > 0 && (
            <button
              type="button"
              disabled={pending}
              className="text-xs text-primary hover:underline disabled:opacity-50"
              onClick={() =>
                startTransition(async () => {
                  await markNotificationsRead({});
                  router.refresh();
                })
              }
            >
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {recent.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          recent.map((n) => (
            <DropdownMenuItem key={n.id} onSelect={() => open(n)} className="flex-col items-start gap-0.5">
              <span className={cn("text-sm", !n.readAt && "font-semibold")}>{n.title}</span>
              {n.body && <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="justify-center">
          <Link href="/notifications">View all</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
