import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { BalanceCards } from "@/components/leave/balance-cards";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, todayInTimeZone } from "@/lib/dates";
import { leaveYearOf, leaveYearRange } from "@/lib/leave";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { requireEmployee } from "@/server/modules/employees/service";
import { getYearConfig, listHolidays, optionalPicksFor } from "@/server/modules/holidays/service";
import { applyLeaveContext } from "@/server/modules/leave/apply-context";
import { balancesFor, leaveYearStartMonth } from "@/server/modules/leave/ledger";
import { myLeaveRequests } from "@/server/modules/leave/queries";
import { getSetting } from "@/server/modules/settings/service";
import { ApplyLeaveButton, MyHolidays, MyRequests } from "./my-leave-client";

export const metadata: Metadata = { title: "My leave" };

/** "2026" for a January leave year, "2026–27" otherwise. */
function yearLabel(year: number, startMonth: number): string {
  return startMonth === 1 ? String(year) : `${year}–${String(year + 1).slice(2)}`;
}

export default async function MyLeavePage({ searchParams }: { searchParams: Promise<{ year?: string; tab?: string }> }) {
  const user = await requireUser();
  if (user.employeeId === null) {
    return (
      <>
        <PageHeader title="My leave" />
        <EmptyState icon={CalendarDays} title="No employee record yet" description="Your login isn't linked to an employee record. Ask HR to link it." />
      </>
    );
  }
  const params = await searchParams;
  const employee = requireEmployee(db, user.employeeId);
  const today = todayInTimeZone(getSetting(db, "locale").timezone);
  const startMonth = leaveYearStartMonth(db);
  const currentYear = leaveYearOf(today, startMonth);
  const requested = Number(params.year);
  const year = Number.isInteger(requested) && Math.abs(requested - currentYear) <= 10 ? requested : currentYear;
  const range = leaveYearRange(year, startMonth);
  const calendarYear = Number(today.slice(0, 4));
  const label = yearLabel(year, startMonth);

  return (
    <>
      <PageHeader
        title="My leave"
        description={`Leave year ${label}: ${formatDate(range.start)} to ${formatDate(range.end)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/me/leave?year=${year - 1}`} aria-label="Previous leave year">
                <ChevronLeft /> {yearLabel(year - 1, startMonth)}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/me/leave?year=${year + 1}`} aria-label="Next leave year">
                {yearLabel(year + 1, startMonth)} <ChevronRight />
              </Link>
            </Button>
            <ApplyLeaveButton context={applyLeaveContext(db, employee, today)} />
          </div>
        }
      />
      <div className="space-y-6">
        <BalanceCards balances={balancesFor(db, employee.id, year)} />
        <Tabs defaultValue={params.tab === "holidays" ? "holidays" : "requests"}>
          <TabsList>
            <TabsTrigger value="requests">Requests</TabsTrigger>
            <TabsTrigger value="holidays">Holidays {calendarYear}</TabsTrigger>
          </TabsList>
          <TabsContent value="requests">
            <MyRequests requests={myLeaveRequests(db, employee.id, year, today)} year={label} />
          </TabsContent>
          <TabsContent value="holidays">
            <MyHolidays
              year={calendarYear}
              holidays={listHolidays(db, calendarYear)}
              picks={optionalPicksFor(db, employee.id, calendarYear, today)}
              allowed={getYearConfig(db, calendarYear).optionalAllowed}
            />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
