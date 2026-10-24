import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardClock } from "lucide-react";
import { TimesheetStatusBadge } from "@/components/timesheets/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { startOfWeek, todayInTimeZone } from "@/lib/dates";
import { formatHours, utilization, weekRangeLabel } from "@/lib/timesheets";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { myWeeks } from "@/server/modules/timesheets/queries";
import { getSetting } from "@/server/modules/settings/service";

export const metadata: Metadata = { title: "My timesheets" };

export default async function MyTimesheetsPage() {
  const user = await requireUser();
  if (user.employeeId === null) {
    return (
      <>
        <PageHeader title="My timesheets" />
        <EmptyState icon={ClipboardClock} title="No employee record yet" description="Your login isn't linked to an employee record. Ask HR to link it." />
      </>
    );
  }
  const today = todayInTimeZone(getSetting(db, "locale").timezone);
  const weeks = myWeeks(db, user.employeeId, { today, count: 12 });
  const current = startOfWeek(today);

  return (
    <>
      <PageHeader
        title="My timesheets"
        description="Log your hours each week and submit them to your manager."
        actions={
          <Button asChild>
            <Link href={`/me/timesheets/${current}`}>Open this week</Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Week</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Logged</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Utilization</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {weeks.map((w) => {
                const { utilizationPct } = utilization(w);
                return (
                  <TableRow key={w.weekStart} data-testid={`week-${w.weekStart}`}>
                    <TableCell className="whitespace-nowrap font-medium">
                      {weekRangeLabel(w.weekStart)}
                      {w.weekStart === current && <span className="ml-2 text-xs font-normal text-muted-foreground">this week</span>}
                    </TableCell>
                    <TableCell>
                      <TimesheetStatusBadge status={w.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatHours(w.loggedMinutes)} h</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{formatHours(w.availableMinutes)} h</TableCell>
                    <TableCell className="text-right tabular-nums">{utilizationPct === null ? "—" : `${utilizationPct}%`}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/me/timesheets/${w.weekStart}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
