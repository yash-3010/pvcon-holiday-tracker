import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatHours, utilization, weekRangeLabel } from "@/lib/timesheets";
import type { WeekSummary } from "@/server/modules/timesheets/queries";
import { TimesheetStatusBadge } from "./status-badge";

/** The profile Timesheets tab: the last weeks with their status and hours. Weeks link to the grid for the employee themselves. */
export function EmployeeTimesheetsTab({ weeks, isSelf }: { weeks: WeekSummary[]; isSelf: boolean }) {
  if (weeks.length === 0) return <EmptyState title="No timesheets yet" description="Weekly timesheets appear here once the employee has joined." />;
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Week</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Logged / available</TableHead>
              <TableHead className="text-right">Billable</TableHead>
              <TableHead className="text-right">Utilization</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {weeks.map((w) => {
              const { utilizationPct } = utilization(w);
              return (
                <TableRow key={w.weekStart}>
                  <TableCell className="whitespace-nowrap">
                    {isSelf ? (
                      <Link href={`/me/timesheets/${w.weekStart}`} className="font-medium hover:underline">
                        {weekRangeLabel(w.weekStart)}
                      </Link>
                    ) : (
                      weekRangeLabel(w.weekStart)
                    )}
                  </TableCell>
                  <TableCell>
                    <TimesheetStatusBadge status={w.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatHours(w.loggedMinutes)} <span className="text-muted-foreground">/ {formatHours(w.availableMinutes)} h</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatHours(w.billableMinutes)} h</TableCell>
                  <TableCell className="text-right tabular-nums">{utilizationPct === null ? "—" : `${utilizationPct}%`}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
