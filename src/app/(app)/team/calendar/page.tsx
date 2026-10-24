import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { addMonths, formatPeriod, isPeriod, todayInTimeZone } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { listLeaveTypes } from "@/server/modules/leave/types";
import { teamCalendar } from "@/server/modules/leave/queries";
import { departmentOptions } from "@/server/modules/org/queries";
import { getSetting } from "@/server/modules/settings/service";
import { CalendarGrid } from "./calendar-grid";

export const metadata: Metadata = { title: "Team calendar" };

export default async function TeamCalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; department?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const today = todayInTimeZone(getSetting(db, "locale").timezone);
  const month = params.month && isPeriod(params.month) ? params.month : today.slice(0, 7);
  const orgWide = can(user, "leave.view.all");
  const departments = orgWide ? departmentOptions(db) : [];
  const departmentId = departments.find((d) => String(d.id) === params.department)?.id;
  const calendar = teamCalendar(db, user, month, { departmentId });
  const link = (m: string) => `/team/calendar?month=${m}${departmentId ? `&department=${departmentId}` : ""}`;
  const types = listLeaveTypes(db);

  return (
    <>
      <PageHeader
        title="Team calendar"
        description={orgWide ? "Who is away, across the company." : "Who is away in your team: you, the people who report to you, and your peers."}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {orgWide && (
              <form method="get" className="flex items-center gap-2">
                <input type="hidden" name="month" value={month} />
                <NativeSelect name="department" defaultValue={departmentId ? String(departmentId) : ""} aria-label="Department" className="w-48">
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </NativeSelect>
                <Button type="submit" variant="outline" size="sm">
                  Show
                </Button>
              </form>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link href={link(addMonths(month, -1))} aria-label="Previous month">
                <ChevronLeft />
              </Link>
            </Button>
            <span className="min-w-32 text-center text-sm font-medium">{formatPeriod(month)}</span>
            <Button variant="outline" size="sm" asChild>
              <Link href={link(addMonths(month, 1))} aria-label="Next month">
                <ChevronRight />
              </Link>
            </Button>
          </div>
        }
      />
      {calendar.rows.length === 0 ? (
        <EmptyState
          icon={CalendarRange}
          title="No team to show"
          description="Your login isn't linked to an employee record, or nobody else is in your team yet."
        />
      ) : (
        <div className="space-y-3">
          <CalendarGrid calendar={calendar} todayDate={today} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {types.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded-sm" style={{ backgroundColor: t.color }} /> {t.name}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm border border-dashed border-muted-foreground" /> Pending
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm bg-muted-foreground" /> Leave (type private)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm bg-warning/30" /> Holiday
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm bg-muted" /> Weekly off
            </span>
            <span>A half-filled day is a half day.</span>
          </div>
        </div>
      )}
    </>
  );
}
