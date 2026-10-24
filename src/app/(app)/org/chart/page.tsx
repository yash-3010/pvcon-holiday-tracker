import type { Metadata } from "next";
import { Network } from "lucide-react";
import { OrgTree } from "@/components/employees/org-tree";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { buildOrgChart } from "@/server/modules/employees/queries";
import { viewableEmployeeIds } from "@/server/modules/employees/scope";

export const metadata: Metadata = { title: "Org chart" };

export default async function OrgChartPage() {
  const user = await requirePermission("directory.view");
  const nodes = buildOrgChart(db);
  const viewable = viewableEmployeeIds(db, user);
  return (
    <>
      <PageHeader title="Org chart" description="Reporting lines of everyone currently at PVCON. Use the arrow next to a manager to show or hide their team." />
      {nodes.length === 0 ? (
        <EmptyState icon={Network} title="No employees yet" description="The chart fills in as HR adds employees and reporting managers." />
      ) : (
        <OrgTree nodes={nodes} profileIds={viewable === "all" ? "all" : new Set(viewable)} />
      )}
    </>
  );
}
