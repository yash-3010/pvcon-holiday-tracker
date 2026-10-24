import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/dates";
import { requireAnyPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listSalaries, structureOptions } from "@/server/modules/payroll/queries";
import { getSetting } from "@/server/modules/settings/service";
import { SalariesClient } from "./salaries-client";

export const metadata: Metadata = { title: "Salaries" };

export default async function SalariesPage() {
  const user = await requireAnyPermission(["salary.view", "salary.manage"]);
  const period = todayInTimeZone(getSetting(db, "locale").timezone).slice(0, 7);
  const salaries = listSalaries(db, { period });
  return (
    <>
      <PageHeader title="Salaries" description="The salary each current employee is paid this month. Revise to change it from a month on." />
      <SalariesClient salaries={salaries} structures={structureOptions(db)} period={period} canManage={can(user, "salary.manage")} />
    </>
  );
}
