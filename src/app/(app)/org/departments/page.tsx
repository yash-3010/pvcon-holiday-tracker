import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { employeeOptions } from "@/server/modules/employees/queries";
import { departmentOptions, listDepartments } from "@/server/modules/org/queries";
import { DepartmentsClient } from "./departments-client";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  await requirePermission("org.manage");
  return (
    <>
      <PageHeader title="Departments" description="Teams employees belong to. Archive a department once nobody is left in it." />
      <DepartmentsClient departments={listDepartments(db)} parentOptions={departmentOptions(db)} headOptions={employeeOptions(db)} />
    </>
  );
}
