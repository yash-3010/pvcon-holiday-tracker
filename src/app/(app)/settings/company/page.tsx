import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getSetting } from "@/server/modules/settings/service";
import { CompanyProfileForm } from "./company-profile-form";
import { LocaleForm } from "./locale-form";
import { LogoCard } from "./logo-card";

export const metadata: Metadata = { title: "Company settings" };

export default async function CompanySettingsPage() {
  await requirePermission("settings.manage");
  const company = getSetting(db, "company");
  const locale = getSetting(db, "locale");
  const timeZones = [...new Set([locale.timezone, ...Intl.supportedValuesOf("timeZone")])].sort();
  return (
    <>
      <PageHeader title="Company" description="Profile, branding and regional settings used across PVCON People." />
      <div className="grid gap-6 lg:grid-cols-2">
        <CompanyProfileForm
          initial={{ legalName: company.legalName, displayName: company.displayName, address: company.address }}
        />
        <div className="space-y-6">
          <LogoCard logoFileId={company.logoFileId} />
          <LocaleForm initial={locale} timeZones={timeZones} />
        </div>
      </div>
    </>
  );
}
