import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ATTENDANCE_MODE_LABELS, type AttendanceStatus } from "@/lib/attendance";
import { formatDate, formatHm, formatMinutes, formatPeriod, type Period } from "@/lib/dates";
import { WEEKDAY_LABELS } from "@/lib/leave";
import type { AttendanceDayRow, ShiftRow } from "@/server/db/schema";
import { ShiftSelect } from "./shift-select";
import { AttendanceStatusBadge } from "./status-badge";

const COUNTS: [AttendanceStatus, string][] = [
  ["present", "Present"],
  ["half_day", "Half days"],
  ["absent", "Absent"],
  ["on_leave", "On leave"],
  ["holiday", "Holidays"],
  ["weekly_off", "Weekly offs"],
];

/** The profile Attendance tab: the shift, this month's counts and the latest days. */
export function EmployeeAttendanceTab({
  employeeId, month, shift, assignedShiftId, counts, recent, shiftChoice, links,
}: {
  employeeId: number;
  month: Period;
  shift: ShiftRow;
  assignedShiftId: number | null;
  counts: Record<AttendanceStatus, number>;
  recent: AttendanceDayRow[];
  /** Present for `shift.manage` holders on a current employee. */
  shiftChoice: { defaultName: string; shifts: { id: number; name: string; times: string }[] } | null;
  links: { muster: boolean; mine: boolean };
}) {
  const offs = [1, 2, 3, 4, 5, 6, 0].filter((d) => shift.weeklyOffs.includes(d)).map((d) => WEEKDAY_LABELS[d]);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Shift{assignedShiftId === null && " (company default)"}</CardDescription>
            <CardTitle className="text-base">
              {shift.name} · {shift.startTime}–{shift.endTime}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Weekly offs: {offs.length ? offs.join(", ") : "none"}. {ATTENDANCE_MODE_LABELS[shift.attendanceMode]}.
            </p>
            {shiftChoice && <ShiftSelect employeeId={employeeId} current={assignedShiftId} {...shiftChoice} />}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-2">
            <div className="space-y-1.5">
              <CardDescription>{formatPeriod(month)}</CardDescription>
              <CardTitle className="text-base">This month so far</CardTitle>
            </div>
            <div className="flex gap-2">
              {links.mine && (
                <Button variant="outline" size="sm" asChild>
                  <Link href="/me/attendance">My attendance</Link>
                </Button>
              )}
              {links.muster && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/time/muster?month=${month}`}>Muster roll</Link>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {COUNTS.map(([status, label]) => (
              <div key={status}>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold tabular-nums">{counts[status] + (status === "on_leave" ? counts.half_leave / 2 : 0)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      {recent.length === 0 ? (
        <EmptyState title="No attendance this month yet" description="Days appear here once they are recorded." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Day</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>In</TableHead>
                  <TableHead>Out</TableHead>
                  <TableHead>Worked</TableHead>
                  <TableHead>Late / early</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((d) => (
                  <TableRow key={d.date}>
                    <TableCell className="whitespace-nowrap">{formatDate(d.date, { weekday: "short", day: "2-digit", month: "short" })}</TableCell>
                    <TableCell>
                      <AttendanceStatusBadge status={d.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">{d.firstIn === null ? "—" : formatHm(d.firstIn)}</TableCell>
                    <TableCell className="tabular-nums">{d.lastOut === null ? "—" : formatHm(d.lastOut)}</TableCell>
                    <TableCell className="tabular-nums">{d.workedMinutes ? formatMinutes(d.workedMinutes) : "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {[d.lateMinutes && `late ${formatMinutes(d.lateMinutes)}`, d.earlyMinutes && `early ${formatMinutes(d.earlyMinutes)}`]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
