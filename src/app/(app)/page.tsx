import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { visibleNav } from "@/components/shell/nav";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { formatDate, todayInTimeZone } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { unreadCount } from "@/server/modules/notifications/service";
import { getSetting } from "@/server/modules/settings/service";

export const metadata: Metadata = { title: "Dashboard" };

function greeting(timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(new Date()),
  );
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export default async function DashboardPage() {
  const user = await requireUser();
  const { timezone } = getSetting(db, "locale");
  const unread = unreadCount(db, user.id);
  const shortcuts = visibleNav(user.permissions)
    .flatMap((g) => g.items)
    .filter((i) => i.href !== "/");

  return (
    <>
      <PageHeader
        title={`${greeting(timezone)}, ${user.name.split(" ")[0]}`}
        description={formatDate(todayInTimeZone(timezone), { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Signed in as</CardDescription>
            <CardTitle className="truncate text-base">{user.email}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {user.roles.map((role) => (
              <Badge key={role}>{ROLE_LABELS[role]}</Badge>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Unread notifications</CardDescription>
            <CardTitle className="text-3xl">{unread}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/notifications">Open inbox</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Shortcuts</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-0.5">
            {shortcuts.map((s) => (
              <Link key={s.href} href={s.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <s.icon className="size-4 text-muted-foreground" />
                {s.title}
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
