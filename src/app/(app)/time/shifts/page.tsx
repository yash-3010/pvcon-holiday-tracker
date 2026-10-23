import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { shiftAssignmentOptions } from "@/server/modules/attendance/queries";
import { listShifts } from "@/server/modules/attendance/shifts";
import { ShiftsClient } from "./shifts-client";

export const metadata: Metadata = { title: "Shifts" };

export default async function ShiftsPage() {
  await requirePermission("shift.manage");
  return (
    <>
      <PageHeader
        title="Shifts"
        description={
          <>
            Working hours, grace, thresholds and weekly offs. Employees without a shift follow the default, chosen in{" "}
            <Link href="/settings/attendance" className="text-primary hover:underline">
              attendance settings
            </Link>
            .
          </>
        }
      />
      <ShiftsClient shifts={listShifts(db, { includeArchived: true })} employees={shiftAssignmentOptions(db)} />
    </>
  );
}
