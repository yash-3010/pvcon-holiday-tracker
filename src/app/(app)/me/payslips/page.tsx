import type { Metadata } from "next";
import Link from "next/link";
import { Download, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addMonths, fiscalYearOf, formatPeriod, isPeriod, todayInTimeZone } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { COMPONENT_KIND_LABELS } from "@/lib/payroll/constants";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { myPayslips, myYearStatement } from "@/server/modules/payroll/queries";
import { getSetting } from "@/server/modules/settings/service";

export const metadata: Metadata = { title: "My payslips" };

const shortMonth = (period: string) => new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));

export default async function MyPayslipsPage({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const user = await requireUser();
  if (user.employeeId === null) {
    return (
      <>
        <PageHeader title="My payslips" />
        <EmptyState icon={ReceiptText} title="No employee record yet" description="Your login isn't linked to an employee record. Ask HR to link it." />
      </>
    );
  }
  const locale = getSetting(db, "locale");
  const thisMonth = todayInTimeZone(locale.timezone).slice(0, 7);
  const requested = (await searchParams).fy;
  const anchor = requested && isPeriod(requested) ? requested : thisMonth;
  const fy = fiscalYearOf(anchor, locale.fiscalYearStartMonth);
  const payslips = myPayslips(db, user.employeeId);
  const statement = myYearStatement(db, user.employeeId, anchor, locale.fiscalYearStartMonth);
  const previousFy = addMonths(fy.start, -1);
  const nextFy = addMonths(fy.end, 1);

  return (
    <>
      <PageHeader title="My payslips" description="Payslips released to you. Each PDF carries a code anyone can verify." />
      <div className="space-y-6">
        {payslips.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No payslips yet" description="Your payslips appear here once payroll releases them." />
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Net pay</TableHead>
                    <TableHead className="w-56" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payslips.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link href={`/me/payslips/${p.id}`} className="font-medium hover:underline">
                          {formatPeriod(p.period)}
                        </Link>
                        {p.runType === "off_cycle" && <span className="ml-2 text-xs text-muted-foreground">Off-cycle</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(p.grossEarnings)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatMoney(p.netPay)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/me/payslips/${p.id}`}>View</Link>
                          </Button>
                          <Button variant="outline" size="sm" asChild>
                            <a href={`/api/payslips/${p.id}/pdf`}>
                              <Download /> PDF
                            </a>
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle>Year statement · {fy.label}</CardTitle>
              <CardDescription>A statement of released payslips in the fiscal year, not a payslip.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/me/payslips?fy=${previousFy}`}>Previous year</Link>
              </Button>
              {nextFy <= thisMonth && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/me/payslips?fy=${nextFy}`}>Next year</Link>
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {statement.periods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payslips in {fy.label}.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Component</TableHead>
                    {statement.periods.map((p) => (
                      <TableHead key={p} className="text-right">
                        {shortMonth(p)}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statement.lines.map((l) => (
                    <TableRow key={l.code}>
                      <TableCell>
                        {l.name} <span className="text-xs text-muted-foreground">{COMPONENT_KIND_LABELS[l.kind]}</span>
                      </TableCell>
                      {l.amounts.map((a, i) => (
                        <TableCell key={i} className="text-right tabular-nums">
                          {a ? formatMoney(a) : "—"}
                        </TableCell>
                      ))}
                      <TableCell className="text-right font-medium tabular-nums">{formatMoney(l.total)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold">
                    <TableCell colSpan={statement.periods.length + 1}>Net pay</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(statement.totals.netPay)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
