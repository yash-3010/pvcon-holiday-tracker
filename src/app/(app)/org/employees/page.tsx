import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listEmployees } from "@/server/modules/employees/queries";
import { departmentOptions } from "@/server/modules/org/queries";
import { EmployeesTable } from "./employees-table";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const user = await requirePermission("employee.view");
  return (
    <>
      <PageHeader
        title="Employees"
        description="Everyone on the employee master, including people on notice and leavers."
        actions={
          <>
            {can(user, "employee.import") && (
              <Button asChild variant="outline">
                <Link href="/org/import">
                  <FileUp /> Import
                </Link>
              </Button>
            )}
            {can(user, "employee.create") && (
              <Button asChild>
                <Link href="/org/employees/new">
                  <UserPlus /> Add employee
                </Link>
              </Button>
            )}
          </>
        }
      />
      <EmployeesTable rows={listEmployees(db)} departments={departmentOptions(db)} />
    </>
  );
}
