import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Fingerprint } from "lucide-react";
import { ClockCard } from "@/components/attendance/clock-card";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { addMonths, formatMinutes, formatPeriod, isPeriod, todayInTimeZone } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { clockCardFor } from "@/server/modules/attendance/clock-card";
import { myAttendanceMonth } from "@/server/modules/attendance/queries";
import { shiftForEmployee } from "@/server/modules/attendance/shifts";
import { getSetting } from "@/server/modules/settings/service";
import { MyAttendanceCalendar } from "./attendance-client";

export const metadata: Metadata = { title: "My attendance" };

export default async function MyAttendancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireUser();
  if (user.employeeId === null) {
    return (
      <>
        <PageHeader title="My attendance" />
        <EmptyState icon={Fingerprint} title="No employee record yet" description="Your login isn't linked to an employee record. Ask HR to link it." />
      </>
    );
  }
  const params = await searchParams;
  const now = new Date();
  const today = todayInTimeZone(getSetting(db, "locale").timezone, now);
  const month = params.month && isPeriod(params.month) ? params.month : today.slice(0, 7);
  const { days, summary } = myAttendanceMonth(db, user.employeeId, month, now);
  const shift = shiftForEmployee(db, user.employeeId);
  const clock = clockCardFor(db, user.employeeId, now);
  const tiles = [
    ["Present", summary.present],
    ["Half days", summary.half_day],
    ["Absent", summary.absent],
    ["Leave", summary.on_leave + summary.half_leave / 2],
    ["Worked", formatMinutes(summary.workedMinutes)],
  ] as const;

  return (
    <>
      <PageHeader
        title="My attendance"
        description="Pick a day to see its punches, correct it or claim comp-off."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/me/attendance?month=${addMonths(month, -1)}`} aria-label="Previous month">
                <ChevronLeft />
              </Link>
            </Button>
            <span className="min-w-32 text-center text-sm font-medium">{formatPeriod(month)}</span>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/me/attendance?month=${addMonths(month, 1)}`} aria-label="Next month">
                <ChevronRight />
              </Link>
            </Button>
          </div>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-4">
          <ClockCard key={clock.renderedAt} {...clock} />
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {tiles.map(([label, value]) => (
              <Card key={label}>
                <CardHeader className="gap-1 p-4">
                  <CardDescription>{label}</CardDescription>
                  <CardTitle className="text-xl tabular-nums">{value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
        <MyAttendanceCalendar days={days} shift={{ start: shift.startTime, end: shift.endTime }} />
      </div>
    </>
  );
}
