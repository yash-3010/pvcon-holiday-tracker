import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import employees" };

export default async function ImportPage() {
  await requirePermission("employee.import");
  return (
    <>
      <PageHeader title="Import employees" description="Add many employee records at once from a CSV file." />
      <ImportClient />
    </>
  );
}
