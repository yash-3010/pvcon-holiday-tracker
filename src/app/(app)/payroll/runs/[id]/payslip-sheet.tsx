"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { PayslipStatusBadge } from "@/components/payroll/run-status-badge";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { formatMoney } from "@/lib/money";
import { COMPONENT_KIND_LABELS } from "@/lib/payroll/constants";
import type { PayslipDetail, RegisterRow } from "@/server/modules/payroll/queries";
import { payslipDetailAction } from "../actions";

/** The drill-down of one payslip: days, every line with how it was worked out, and the PDF. */
export function PayslipSheet({ row, onOpenChange }: { row: RegisterRow | null; onOpenChange: (open: boolean) => void }) {
  // The loaded result remembers which payslip it is for, so a new row shows the spinner until its own arrives.
  const [result, setResult] = useState<{ payslipId: number; detail: PayslipDetail | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!row) return;
    let live = true;
    void payslipDetailAction({ payslipId: row.payslipId }).then((r) => {
      if (live) setResult({ payslipId: row.payslipId, detail: r.ok ? r.data : null, error: r.ok ? null : r.error });
    });
    return () => {
      live = false;
    };
  }, [row]);
  const current = result && row && result.payslipId === row.payslipId ? result : null;
  const detail = current?.detail ?? null;
  const error = current?.error ?? null;

  const p = detail?.payslip;
  return (
    <Sheet open={!!row} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{row?.name}</SheetTitle>
          <SheetDescription>{row?.code}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-1 text-sm">
          {error && <Alert variant="destructive">{error}</Alert>}
          {!detail && !error && (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          )}
          {p && detail && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <PayslipStatusBadge status={p.status} />
                {p.releasedAt ? (
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/payslips/${p.id}/pdf?inline=1`} target="_blank" rel="noreferrer">
                      <FileText /> Payslip PDF
                    </a>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" asChild>
                    <a href={`/api/payslips/${p.id}/pdf?preview=1`} target="_blank" rel="noreferrer">
                      <FileText /> Draft preview
                    </a>
                  </Button>
                )}
              </div>
              {p.error && <Alert variant="destructive" title="Not computed">{p.error}</Alert>}
              {p.warnings.length > 0 && !p.error && (
                <Alert variant="warning" title="Check">
                  {p.warnings.join(" · ")}
                </Alert>
              )}
              <dl className="grid grid-cols-4 gap-2 rounded-lg bg-muted/60 p-3">
                {(
                  [
                    ["Total days", p.totalDays], ["Working days", p.workingDays], ["Paid days", p.paidDays], ["LOP days", p.lopDays],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="font-medium tabular-nums">{Number(value.toFixed(2))}</dd>
                  </div>
                ))}
              </dl>
              <table className="w-full">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-1 text-left font-normal">Line</th>
                    <th className="py-1 text-right font-normal">Full month</th>
                    <th className="py-1 text-right font-normal">This month</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((l, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-1.5">
                        <div>
                          {l.name} <span className="text-xs text-muted-foreground">· {COMPONENT_KIND_LABELS[l.kind]}</span>
                        </div>
                        {l.explanation && l.explanation !== l.name && <div className="font-mono text-xs text-muted-foreground">{l.explanation}</div>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">{l.rate === null ? "" : formatMoney(l.rate)}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {l.kind === "deduction" ? "−" : ""}
                        {formatMoney(l.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="grid gap-1 rounded-lg border p-3">
                {(
                  [
                    ["Gross earnings (with reimbursements)", p.grossEarnings], ["Deductions", p.totalDeductions],
                    ["Employer contributions", p.employerContributions], ["Net pay", p.netPay],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex justify-between last:font-semibold">
                    <dt>{label}</dt>
                    <dd className="tabular-nums">{formatMoney(value)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
