import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { addMonths, todayInTimeZone } from "@/lib/dates";
import { requireAnyPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listRuns } from "@/server/modules/payroll/queries";
import { getSetting } from "@/server/modules/settings/service";
import { RunsClient } from "./runs-client";

export const metadata: Metadata = { title: "Payroll runs" };

export default async function RunsPage() {
  const user = await requireAnyPermission(["payroll.run", "payroll.approve", "payroll.release"]);
  const runs = listRuns(db);
  const thisMonth = todayInTimeZone(getSetting(db, "locale").timezone).slice(0, 7);
  // Suggest the month after the latest regular run, else last month.
  const latest = runs.find((r) => r.type === "regular" && r.status !== "cancelled");
  const suggested = latest ? addMonths(latest.period, 1) : addMonths(thisMonth, -1);
  return (
    <>
      <PageHeader title="Payroll runs" description="Compute, review, approve and release each month's pay. Off-cycle runs pay bonuses and settlements." />
      <RunsClient runs={runs} canCreate={can(user, "payroll.run")} suggestedPeriod={suggested} maxPeriod={addMonths(thisMonth, 1)} />
    </>
  );
}
