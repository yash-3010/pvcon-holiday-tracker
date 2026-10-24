import type { Metadata } from "next";
import { headers } from "next/headers";
import { BadgeCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { formatDate } from "@/lib/dates";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { clientIp } from "@/server/lib/request";
import { lookupPayslip, type VerificationResult } from "@/server/modules/payroll/verify";
import { NetPayCheck } from "./net-pay-check";

export const metadata: Metadata = { title: "Verify a payslip", robots: { index: false, follow: false } };

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

/** Public payslip verification (spec §5.6): no sign-in, rate-limited, never shows the net pay. */
export default async function VerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const h = await headers();
  let result: VerificationResult | null = null;
  let error: string | null = null;
  try {
    result = lookupPayslip(db, code, { ip: clientIp(h), userAgent: h.get("user-agent"), netPay: null });
  } catch (err) {
    if (!(err instanceof DomainError)) throw err;
    error = err.message;
  }
  if (error) return <Alert variant="warning" title="Please wait">{error}</Alert>;
  if (!result) {
    return (
      <Alert variant="destructive" title="Not found">
        No payslip was issued with this code. Check the code printed under the QR code.
      </Alert>
    );
  }
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-success">
        <BadgeCheck aria-hidden className="size-6" />
        <h1 className="text-lg font-semibold">Genuine payslip</h1>
      </div>
      <dl className="divide-y">
        <Row label="Issued by" value={result.company} />
        <Row label="Employee" value={result.maskedName} />
        <Row label="Period" value={result.period} />
        <Row label="Issued on" value={formatDate(result.issuedOn)} />
      </dl>
      <NetPayCheck code={code} />
    </div>
  );
}
