import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { todayInTimeZone } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getYearConfig, listHolidaysWithPicks } from "@/server/modules/holidays/service";
import { getSetting } from "@/server/modules/settings/service";
import { HolidaysClient } from "./holidays-client";

export const metadata: Metadata = { title: "Holidays" };

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requirePermission("holiday.manage");
  const thisYear = Number(todayInTimeZone(getSetting(db, "locale").timezone).slice(0, 4));
  const requested = Number((await searchParams).year);
  const year = Number.isInteger(requested) && requested >= 2000 && requested <= 2100 ? requested : thisYear;

  return (
    <>
      <PageHeader
        title={`Holidays ${year}`}
        description="The company holiday calendar and the optional holidays employees can choose from."
        actions={
          <div className="flex gap-1">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/leave/holidays?year=${year - 1}`}>
                <ChevronLeft /> {year - 1}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/leave/holidays?year=${year + 1}`}>
                {year + 1} <ChevronRight />
              </Link>
            </Button>
          </div>
        }
      />
      <HolidaysClient year={year} holidays={listHolidaysWithPicks(db, year)} optionalAllowed={getYearConfig(db, year).optionalAllowed} />
    </>
  );
}
