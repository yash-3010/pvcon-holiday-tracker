import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, ChevronRight, ClipboardClock } from "lucide-react";
import { TimesheetStatusBadge } from "@/components/timesheets/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { addDays, diffDays, isISODate, startOfWeek, todayInTimeZone } from "@/lib/dates";
import { weekRangeLabel } from "@/lib/timesheets";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { weekDetail } from "@/server/modules/timesheets/queries";
import { getSetting } from "@/server/modules/settings/service";
import { WeekEditor } from "./week-client";

export const metadata: Metadata = { title: "Timesheet" };

export default async function TimesheetWeekPage({ params }: { params: Promise<{ week: string }> }) {
  const user = await requireUser();
  if (user.employeeId === null) {
    return (
      <>
        <PageHeader title="Timesheet" />
        <EmptyState icon={ClipboardClock} title="No employee record yet" description="Your login isn't linked to an employee record. Ask HR to link it." />
      </>
    );
  }
  const { week } = await params;
  if (!isISODate(week)) notFound();
  const monday = startOfWeek(week);
  if (monday !== week) redirect(`/me/timesheets/${monday}`);
  const timeZone = getSetting(db, "locale").timezone;
  const now = new Date();
  const today = todayInTimeZone(timeZone, now);
  const current = startOfWeek(today);
  if (Math.abs(diffDays(monday, current)) > 52 * 7) notFound();
  const detail = weekDetail(db, user.employeeId, monday, { today, now });

  return (
    <>
      <PageHeader
        title="Timesheet"
        description={weekRangeLabel(monday)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TimesheetStatusBadge status={detail.status} />
            <Button variant="outline" size="sm" asChild>
              <Link href={`/me/timesheets/${addDays(monday, -7)}`} aria-label="Previous week">
                <ChevronLeft />
              </Link>
            </Button>
            {monday !== current && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/me/timesheets/${current}`}>This week</Link>
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href={`/me/timesheets/${addDays(monday, 7)}`} aria-label="Next week">
                <ChevronRight />
              </Link>
            </Button>
          </div>
        }
      />
      {/* Remount when the stored week changes, so the grid starts from what was saved. */}
      <WeekEditor
        key={`${detail.status}:${JSON.stringify(detail.rows)}:${detail.timer?.startedAt ?? ""}`}
        detail={detail}
        today={today}
        isCurrentWeek={monday === current}
        timeZone={timeZone}
        renderedAt={now.getTime()}
      />
    </>
  );
}
