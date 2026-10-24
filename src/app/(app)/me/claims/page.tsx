import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { todayInTimeZone } from "@/lib/dates";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { myClaims } from "@/server/modules/payroll/queries";
import { getSetting } from "@/server/modules/settings/service";
import { MyClaimsClient } from "./my-claims-client";

export const metadata: Metadata = { title: "My claims" };

export default async function MyClaimsPage() {
  const user = await requireUser();
  if (user.employeeId === null) {
    return (
      <>
        <PageHeader title="My claims" />
        <EmptyState icon={Receipt} title="No employee record yet" description="Your login isn't linked to an employee record. Ask HR to link it." />
      </>
    );
  }
  return (
    <>
      <PageHeader title="My claims" description="Claim expenses you paid for work, with the receipt. Approved claims are paid with the next payroll." />
      <MyClaimsClient claims={myClaims(db, user.employeeId)} today={todayInTimeZone(getSetting(db, "locale").timezone)} />
    </>
  );
}
