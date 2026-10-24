import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Grid3x3 } from "lucide-react";
import { ATTENDANCE_CELL_CLASSES } from "@/components/attendance/status-badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { ATTENDANCE_CODES, ATTENDANCE_STATUS_LABELS, ATTENDANCE_STATUSES } from "@/lib/attendance";
import { can } from "@/lib/auth/permissions";
import { addMonths, formatPeriod, isPeriod, todayInTimeZone } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { requireAnyPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { musterRoll } from "@/server/modules/attendance/queries";
import { departmentOptions } from "@/server/modules/org/queries";
import { getSetting } from "@/server/modules/settings/service";
import { MusterGrid } from "./muster-client";

export const metadata: Metadata = { title: "Muster roll" };

export default async function MusterRollPage({ searchParams }: { searchParams: Promise<{ month?: string; department?: string }> }) {
  const user = await requireAnyPermission(["attendance.view.all", "regularization.approve"]);
  const params = await searchParams;
  const now = new Date();
  const today = todayInTimeZone(getSetting(db, "locale").timezone, now);
  const month = params.month && isPeriod(params.month) ? params.month : today.slice(0, 7);
  const orgWide = can(user, "attendance.view.all");
  const departments = orgWide ? departmentOptions(db) : [];
  const departmentId = departments.find((d) => String(d.id) === params.department)?.id;
  const muster = musterRoll(db, user, month, { departmentId }, now);
  const link = (m: string) => `/time/muster?month=${m}${departmentId ? `&department=${departmentId}` : ""}`;

  return (
    <>
      <PageHeader
        title="Muster roll"
        description={orgWide ? "Daily attendance codes for everyone. Select a day for its punches." : "Daily attendance codes for your team. Select a day for its punches."}
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
      {muster.rows.length === 0 ? (
        <EmptyState icon={Grid3x3} title="Nobody to show" description="No current employees match, or nobody reports to you yet." />
      ) : (
        <div className="space-y-3">
          <MusterGrid muster={muster} today={today} canManage={can(user, "attendance.manage")} ownEmployeeId={user.employeeId} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            {ATTENDANCE_STATUSES.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={cn("inline-flex h-5 min-w-7 items-center justify-center rounded px-1 font-semibold", ATTENDANCE_CELL_CLASSES[s])}>
                  {ATTENDANCE_CODES[s]}
                </span>
                {ATTENDANCE_STATUS_LABELS[s]}
              </span>
            ))}
            <span>A dot marks an HR override; today is provisional until the day closes.</span>
          </div>
        </div>
      )}
    </>
  );
}
