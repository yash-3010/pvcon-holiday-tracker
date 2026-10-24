import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listComponents } from "@/server/modules/payroll/components";
import { listStructures, structureLines } from "@/server/modules/payroll/structures";
import { StructuresClient } from "./structures-client";

export const metadata: Metadata = { title: "Salary structures" };

export default async function StructuresPage() {
  await requirePermission("payroll.configure");
  const structures = listStructures(db).map((s) => ({ ...s, lines: structureLines(db, s.id) }));
  return (
    <>
      <PageHeader
        title="Salary structures"
        description="Ordered sets of components. A structure line can replace a component's amount, percent or formula; employees can override further."
      />
      <StructuresClient structures={structures} components={listComponents(db, { includeArchived: true })} />
    </>
  );
}
