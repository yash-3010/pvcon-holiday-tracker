import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listComponents } from "@/server/modules/payroll/components";
import { ComponentsClient } from "./components-client";

export const metadata: Metadata = { title: "Salary components" };

export default async function ComponentsPage() {
  await requirePermission("payroll.configure");
  return (
    <>
      <PageHeader
        title="Salary components"
        description="Earnings, deductions, employer contributions and reimbursements that structures are built from. Formulas work in rupees."
      />
      <ComponentsClient components={listComponents(db, { includeArchived: true })} />
    </>
  );
}
