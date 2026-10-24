import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listDesignations } from "@/server/modules/org/queries";
import { DesignationsClient } from "./designations-client";

export const metadata: Metadata = { title: "Designations" };

export default async function DesignationsPage() {
  await requirePermission("org.manage");
  return (
    <>
      <PageHeader title="Designations" description="Job titles used on profiles, payslips and letters." />
      <DesignationsClient designations={listDesignations(db)} />
    </>
  );
}
