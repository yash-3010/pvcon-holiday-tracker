import type { Metadata } from "next";
import { count } from "drizzle-orm";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { leaveLedger } from "@/server/db/schema";
import { getSetting } from "@/server/modules/settings/service";
import { LeaveSettingsForm } from "./leave-settings-form";

export const metadata: Metadata = { title: "Leave settings" };

export default async function LeaveSettingsPage() {
  await requirePermission("leave.config");
  const yearLocked = (db.select({ n: count() }).from(leaveLedger).get()?.n ?? 0) > 0;
  return (
    <>
      <PageHeader title="Leave settings" description="When the leave year starts." />
      <LeaveSettingsForm
        initial={{ yearStartMonth: getSetting(db, "leave").yearStartMonth }}
        yearLocked={yearLocked}
      />
    </>
  );
}
