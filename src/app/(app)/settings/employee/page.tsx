import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { nextEmployeeCode } from "@/server/modules/employees/code";
import { getSetting } from "@/server/modules/settings/service";
import { EmployeeSettingsForm } from "./employee-settings-form";

export const metadata: Metadata = { title: "Employee codes" };

export default async function EmployeeSettingsPage() {
  await requirePermission("settings.manage");
  return (
    <>
      <PageHeader title="Employee codes" description="How new employee codes are generated." />
      <EmployeeSettingsForm initial={getSetting(db, "employee")} nextCode={nextEmployeeCode(db)} />
    </>
  );
}
