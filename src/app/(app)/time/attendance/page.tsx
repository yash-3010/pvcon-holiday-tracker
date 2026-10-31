import type { Metadata } from "next";
import Link from "next/link";
import { UserRoundCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WORK_MODE_LABELS } from "@/lib/attendance";
import { formatDate, formatMinutes, todayInTimeZone } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requireAnyPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { todayBoard, type BoardState, type TodayBoardRow } from "@/server/modules/attendance/queries";
import { getSetting } from "@/server/modules/settings/service";

export const metadata: Metadata = { title: "Today" };

const STATE: Record<BoardState, { label: string; variant: "success" | "secondary" | "info" | "default" | "destructive" }> = {
  in: { label: "In", variant: "success" },
  break: { label: "On break", variant: "info" },
  out: { label: "Left", variant: "secondary" },
  not_in: { label: "Not in yet", variant: "destructive" },
  on_leave: { label: "On leave", variant: "info" },
  holiday: { label: "Holiday", variant: "default" },
  weekly_off: { label: "Weekly off", variant: "secondary" },
};
const ORDER: BoardState[] = ["in", "break", "out", "not_in", "on_leave", "holiday", "weekly_off"];

const FILTERS = {
  in: { label: "In", match: (r: TodayBoardRow) => r.state === "in" || r.state === "break" },
  remote: { label: "Remote", match: (r: TodayBoardRow) => (r.state === "in" || r.state === "break") && r.workMode === "remote" },
  late: { label: "Late", match: (r: TodayBoardRow) => r.late },
  onLeave: { label: "On leave", match: (r: TodayBoardRow) => r.state === "on_leave" },
  notIn: { label: "Not in yet", match: (r: TodayBoardRow) => r.state === "not_in" },
} as const;
type Filter = keyof typeof FILTERS;

export default async function TodayBoardPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireAnyPermission(["attendance.view.all", "regularization.approve"]);
  const show = (await searchParams).show;
  const filter = show && show in FILTERS ? (show as Filter) : null;
  const now = new Date();
  const today = todayInTimeZone(getSetting(db, "locale").timezone, now);
  const board = todayBoard(db, user, now);
  const rows = board.rows
    .filter((r) => !filter || FILTERS[filter].match(r))
    .sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Today"
        description={`${formatDate(today, { weekday: "long", day: "numeric", month: "long" })}: who is in, remote, late or away.`}
      />
      {board.rows.length === 0 ? (
        <EmptyState icon={UserRoundCheck} title="Nobody to show" description="No current employees, or nobody reports to you yet." />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {(Object.keys(FILTERS) as Filter[]).map((key) => (
              <Link key={key} href={filter === key ? "/time/attendance" : `/time/attendance?show=${key}`} aria-current={filter === key ? "true" : undefined}>
                <Card className={cn("transition-colors hover:border-primary/40", filter === key && "border-primary ring-1 ring-primary")}>
                  <CardHeader className="gap-1 p-4">
                    <CardDescription>{FILTERS[key].label}</CardDescription>
                    <CardTitle className="text-2xl tabular-nums">{board.totals[key]}</CardTitle>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>First in</TableHead>
                    <TableHead>Worked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                        Nobody right now.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <TableRow key={r.employeeId}>
                        <TableCell>
                          <span className="font-medium">{r.name}</span>
                          <p className="text-xs text-muted-foreground">{r.code}</p>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.department ?? "—"}</TableCell>
                        <TableCell>
                          <span className="flex flex-wrap gap-1">
                            <Badge variant={STATE[r.state].variant}>{STATE[r.state].label}</Badge>
                            {r.workMode && (r.state === "in" || r.state === "out") && <Badge variant="outline">{WORK_MODE_LABELS[r.workMode]}</Badge>}
                            {r.late && <Badge variant="warning">Late</Badge>}
                          </span>
                        </TableCell>
                        <TableCell className="tabular-nums">{r.firstIn ?? "—"}</TableCell>
                        <TableCell className="tabular-nums">{r.workedMinutes > 0 ? formatMinutes(r.workedMinutes) : "—"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
