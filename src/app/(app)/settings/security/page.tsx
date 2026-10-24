import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getSetting } from "@/server/modules/settings/service";
import { SecurityForm } from "./security-form";

export const metadata: Metadata = { title: "Security settings" };

export default async function SecuritySettingsPage() {
  await requirePermission("settings.manage");
  return (
    <>
      <PageHeader title="Security" description="Account lockout and password rules." />
      <SecurityForm initial={getSetting(db, "security")} />
    </>
  );
}
