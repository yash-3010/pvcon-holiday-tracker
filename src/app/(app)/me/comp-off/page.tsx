import type { Metadata } from "next";
import { Gift } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, todayInTimeZone } from "@/lib/dates";
import { formatDays } from "@/lib/leave";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { myCompOff } from "@/server/modules/compoff/queries";
import { getSetting } from "@/server/modules/settings/service";
import { Claims, EligibleDays, Lots } from "./comp-off-client";

export const metadata: Metadata = { title: "My comp-off" };

export default async function MyCompOffPage() {
  const user = await requireUser();
  if (user.employeeId === null) {
    return (
      <>
        <PageHeader title="My comp-off" />
        <EmptyState icon={Gift} title="No employee record yet" description="Your login isn't linked to an employee record. Ask HR to link it." />
      </>
    );
  }
  const today = todayInTimeZone(getSetting(db, "locale").timezone);
  const settings = getSetting(db, "compOff");
  const mine = myCompOff(db, user.employeeId, today);
  const pending = mine.claims.filter((c) => c.status === "pending");

  return (
    <>
      <PageHeader
        title="My comp-off"
        description={`Compensatory off for work on weekly offs and holidays. Each grant expires ${settings.expiryDays} days after the day worked; apply for it as Comp-off leave.`}
      />
      <div className="space-y-6">
        {!settings.enabled && (
          <Alert title="Comp-off claims are switched off">Days you already have can still be used.</Alert>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>Available</CardDescription>
              <CardTitle className="text-3xl tabular-nums" data-testid="compoff-available">
                {mine.available}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Next expiry</CardDescription>
              <CardTitle className="text-base">
                {mine.nextExpiry ? `${formatDays(mine.nextExpiry.days)} on ${formatDate(mine.nextExpiry.date)}` : "Nothing expiring"}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Claims waiting for approval</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{pending.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>
        {settings.enabled && <EligibleDays days={mine.eligible} windowDays={settings.claimWindowDays} />}
        <Tabs defaultValue="lots">
          <TabsList>
            <TabsTrigger value="lots">Earned</TabsTrigger>
            <TabsTrigger value="claims">Claims</TabsTrigger>
          </TabsList>
          <TabsContent value="lots">
            <Lots lots={mine.lots} today={today} />
          </TabsContent>
          <TabsContent value="claims">
            <Claims claims={mine.claims} />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
