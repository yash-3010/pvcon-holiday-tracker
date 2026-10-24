import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listCategories } from "@/server/modules/projects/queries";
import { CategoriesClient } from "./categories-client";

export const metadata: Metadata = { title: "Task categories" };

export default async function CategoriesPage() {
  await requirePermission("project.manage");
  return (
    <>
      <PageHeader title="Task categories" description="The kinds of work people log time to. Archived categories keep their history." />
      <CategoriesClient categories={listCategories(db, { includeArchived: true })} />
    </>
  );
}
