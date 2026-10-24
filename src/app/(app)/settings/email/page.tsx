import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { smtpStatus } from "@/server/lib/email";
import { emailOutbox } from "@/server/modules/notifications/email";
import { TestEmailButton } from "./test-email-button";

export const metadata: Metadata = { title: "Email settings" };

export default async function EmailSettingsPage() {
  const user = await requirePermission("settings.manage");
  const smtp = smtpStatus();
  const outbox = emailOutbox(db, new Date());
  const rows: [string, string][] = [
    ["Server", smtp.host ?? "Not set"],
    ["Port", `${smtp.port}${smtp.secure ? " (TLS)" : " (STARTTLS when offered)"}`],
    ["From", smtp.from ?? "Not set"],
    ["Sign-in", smtp.authenticated ? "User name and password set" : "None"],
  ];
  const counts: [string, number][] = [
    ["Waiting to send", outbox.pending],
    ["In tomorrow's digest", outbox.digest],
    ["Sent in the last day", outbox.sentLastDay],
    ["Failed in the last day", outbox.failedLastDay],
  ];
  return (
    <>
      <PageHeader title="Email" description="The mail server used for notifications, password resets and payslips." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle className="text-base">Mail server</CardTitle>
              <CardDescription>Set with the SMTP_* variables on the server; restart the app after a change.</CardDescription>
            </div>
            <Badge variant={smtp.configured ? "success" : "warning"}>{smtp.configured ? "Configured" : "Not configured"}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center gap-3">
              <TestEmailButton disabled={!smtp.configured} />
              <span className="text-xs text-muted-foreground">Goes to {user.email}.</span>
            </div>
            {!smtp.configured && <p className="text-sm text-muted-foreground">Without a mail server, emails are skipped and only logged.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notification emails</CardTitle>
            <CardDescription>Sent every 10 minutes by the notifications:send job; digests at 09:00.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3">
              {counts.map(([label, value]) => (
                <div key={label} className="rounded-lg border p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
