import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getSetting } from "@/server/modules/settings/service";
import { CompOffSettingsForm } from "./comp-off-settings-form";

export const metadata: Metadata = { title: "Comp-off settings" };

export default async function CompOffSettingsPage() {
  await requirePermission("leave.config");
  return (
    <>
      <PageHeader title="Comp-off settings" description="Earning, claiming and expiry of compensatory off." />
      <CompOffSettingsForm initial={getSetting(db, "compOff")} />
    </>
  );
}
