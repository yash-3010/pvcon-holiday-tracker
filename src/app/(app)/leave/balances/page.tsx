import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/dates";
import { leaveYearOf } from "@/lib/leave";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { employeeOptions } from "@/server/modules/employees/queries";
import { leaveYearStartMonth } from "@/server/modules/leave/ledger";
import { balanceSheet } from "@/server/modules/leave/queries";
import { departmentOptions } from "@/server/modules/org/queries";
import { getSetting } from "@/server/modules/settings/service";
import { BalancesClient } from "./balances-client";

export const metadata: Metadata = { title: "Leave balances" };

export default async function LeaveBalancesPage({ searchParams }: { searchParams: Promise<{ year?: string; department?: string }> }) {
  const user = await requirePermission("leave.view.all");
  const params = await searchParams;
  const current = leaveYearOf(todayInTimeZone(getSetting(db, "locale").timezone), leaveYearStartMonth(db));
  const requested = Number(params.year);
  const year = Number.isInteger(requested) && Math.abs(requested - current) <= 10 ? requested : current;
  const departments = departmentOptions(db);
  const departmentId = departments.find((d) => String(d.id) === params.department)?.id;
  const query = (y: number) => `/leave/balances?year=${y}${departmentId ? `&department=${departmentId}` : ""}`;

  return (
    <>
      <PageHeader
        title={`Leave balances ${year}`}
        description="Balances per leave year. Select a balance to see its ledger."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <form method="get" className="flex items-center gap-2">
              <input type="hidden" name="year" value={year} />
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
            <Button variant="outline" size="sm" asChild>
              <Link href={query(year - 1)}>
                <ChevronLeft /> {year - 1}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={query(year + 1)}>
                {year + 1} <ChevronRight />
              </Link>
            </Button>
          </div>
        }
      />
      <BalancesClient
        sheet={balanceSheet(db, year, { departmentId })}
        year={year}
        canAdjust={can(user, "leave.adjust")}
        employees={employeeOptions(db).filter((e) => e.id !== user.employeeId)}
      />
    </>
  );
}
