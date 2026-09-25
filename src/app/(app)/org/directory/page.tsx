import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listDirectory } from "@/server/modules/employees/queries";
import { viewableEmployeeIds } from "@/server/modules/employees/scope";
import { departmentOptions } from "@/server/modules/org/queries";
import { DirectoryClient } from "./directory-client";

export const metadata: Metadata = { title: "Directory" };

export default async function DirectoryPage() {
  const user = await requirePermission("directory.view");
  const entries = listDirectory(db);
  const viewable = viewableEmployeeIds(db, user);
  return (
    <>
      <PageHeader title="Directory" description="Everyone currently at PVCON." />
      <DirectoryClient
        entries={entries}
        departments={departmentOptions(db)}
        profileIds={viewable === "all" ? entries.map((e) => e.id) : viewable}
      />
    </>
  );
}
