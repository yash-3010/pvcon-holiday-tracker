import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatPeriod } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { verificationLog } from "@/server/modules/payroll/queries";
import { getSetting } from "@/server/modules/settings/service";
import { PayrollSettingsForm } from "./payroll-settings-form";
import { SignatureCard } from "./signature-card";

export const metadata: Metadata = { title: "Payroll settings" };

export default async function PayrollSettingsPage() {
  await requirePermission("payroll.configure");
  const { signatoryImageFileId, ...settings } = getSetting(db, "payroll");
  const timezone = getSetting(db, "locale").timezone;
  const log = verificationLog(db, { limit: 50 });
  return (
    <>
      <PageHeader title="Payroll settings" description="Proration, payslip content and delivery, and payslip verification." />
      <div className="grid gap-6 lg:grid-cols-2">
        <PayrollSettingsForm initial={settings} />
        <div className="space-y-6">
          <SignatureCard fileId={signatoryImageFileId} />
          <Card>
            <CardHeader>
              <CardTitle>Verification lookups</CardTitle>
              <CardDescription>The latest checks of payslip codes on the public verify page.</CardDescription>
            </CardHeader>
            <CardContent>
              {log.length === 0 ? (
                <p className="text-sm text-muted-foreground">No lookups yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Payslip</TableHead>
                      <TableHead>Net pay check</TableHead>
                      <TableHead>Address</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {log.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="whitespace-nowrap text-xs">{formatDateTime(v.at, timezone)}</TableCell>
                        <TableCell>
                          <div className="text-sm">{v.employeeName}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatPeriod(v.period)} · {v.code}
                          </div>
                        </TableCell>
                        <TableCell>
                          {!v.amountChecked ? (
                            <span className="text-xs text-muted-foreground">Not checked</span>
                          ) : v.matched ? (
                            <Badge variant="success">Matched</Badge>
                          ) : (
                            <Badge variant="destructive">No match</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{v.ip ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
