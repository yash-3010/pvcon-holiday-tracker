import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dateInTimeZone, formatDate, formatPeriod } from "@/lib/dates";
import { amountInWords, formatMoney } from "@/lib/money";
import type { ComponentKind } from "@/lib/payroll/constants";
import { requireUser } from "@/server/auth/session";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { payslipDetail } from "@/server/modules/payroll/queries";
import { verifyUrl } from "@/server/modules/payroll/payslips";
import { getSetting } from "@/server/modules/settings/service";

export const metadata: Metadata = { title: "Payslip" };

export default async function MyPayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  const detail = Number.isInteger(id) && id > 0 ? payslipDetail(db, id) : null;
  // Someone else's payslip, or one not released yet, looks exactly like a missing one.
  if (!detail || detail.payslip.employeeId !== user.employeeId || !detail.payslip.releasedAt) notFound();
  const { payslip: p, lines } = detail;
  const locale = getSetting(db, "locale");
  const visible = lines.filter((l) => l.showOnPayslip);
  const section = (kind: ComponentKind) => visible.filter((l) => l.kind === kind);
  const groups: [string, ComponentKind][] = [["Earnings", "earning"], ["Reimbursements", "reimbursement"], ["Deductions", "deduction"]];

  return (
    <>
      <PageHeader
        title={`Payslip for ${formatPeriod(detail.period)}`}
        description={`Released on ${formatDate(dateInTimeZone(new Date(p.releasedAt!), locale.timezone))}${detail.runType === "off_cycle" ? " · off-cycle" : ""}`}
        actions={
          <Button asChild>
            <a href={`/api/payslips/${p.id}/pdf`}>
              <Download /> Download PDF
            </a>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="space-y-6 p-6">
            {groups.map(([title, kind]) =>
              section(kind).length ? (
                <Table key={kind}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{title}</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {section(kind).map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>{l.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(l.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : null,
            )}
            <div className="flex items-end justify-between rounded-lg bg-muted/60 p-4">
              <div>
                <p className="text-xs text-muted-foreground">Net pay</p>
                <p className="text-sm">{amountInWords(p.netPay, locale.currency)}</p>
              </div>
              <p className="text-2xl font-semibold tabular-nums">{formatMoney(p.netPay)}</p>
            </div>
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Days</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {(
                  [
                    ["Total days", p.totalDays], ["Working days", p.workingDays], ["Paid days", p.paidDays], ["Loss of pay days", p.lopDays],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="font-medium tabular-nums">{Number(value.toFixed(2))}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          {p.verificationCode && (
            <Card>
              <CardHeader>
                <CardTitle>Verification</CardTitle>
                <CardDescription>Anyone you share the PDF with can check it is genuine.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="font-mono">{p.verificationCode}</p>
                <a href={verifyUrl(config.appUrl, p.verificationCode)} className="break-all text-primary hover:underline" target="_blank" rel="noreferrer">
                  {verifyUrl(config.appUrl, p.verificationCode)}
                </a>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
