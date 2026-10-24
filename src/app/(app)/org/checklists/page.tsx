import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listChecklistTemplates } from "@/server/modules/employees/checklists";
import { TemplatesClient } from "./templates-client";

export const metadata: Metadata = { title: "Checklists" };

export default async function ChecklistsPage() {
  await requirePermission("employee.update");
  return (
    <>
      <PageHeader title="Checklists" description="Onboarding and offboarding templates. Each employee gets a copy they can tick off." />
      <TemplatesClient templates={listChecklistTemplates(db)} />
    </>
  );
}
