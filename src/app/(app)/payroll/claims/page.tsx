import type { Metadata } from "next";
import Link from "next/link";
import { Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canAny } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { CLAIM_CATEGORY_LABELS, CLAIM_STATUSES, CLAIM_STATUS_BADGE, CLAIM_STATUS_LABELS, type ClaimStatus } from "@/lib/payroll/constants";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listClaims } from "@/server/modules/payroll/queries";

export const metadata: Metadata = { title: "Expense claims" };

const FILTERS: ClaimStatus[] = CLAIM_STATUSES.filter((s) => s !== "draft");

export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requirePermission("claim.view.all");
  const requested = (await searchParams).status;
  const status = FILTERS.includes(requested as ClaimStatus) ? (requested as ClaimStatus) : undefined;
  const claims = listClaims(db, { status });
  const seesRuns = canAny(user, ["payroll.run", "payroll.approve", "payroll.release"]);
  const total = claims.reduce((s, c) => s + c.amount, 0);
  return (
    <>
      <PageHeader title="Expense claims" description="Claims submitted by everyone. Approved claims are paid with the next regular payroll run." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[undefined, ...FILTERS].map((s) => (
          <Link
            key={s ?? "all"}
            href={s ? `/payroll/claims?status=${s}` : "/payroll/claims"}
            className={cn("rounded-full border px-3 py-1 text-sm", s === status ? "border-primary bg-primary-soft text-primary" : "text-muted-foreground hover:bg-muted")}
          >
            {s ? CLAIM_STATUS_LABELS[s] : "All"}
          </Link>
        ))}
        <span className="ml-auto text-sm text-muted-foreground">
          {claims.length} claim(s) · {formatMoney(total)}
        </span>
      </div>
      {claims.length === 0 ? (
        <EmptyState title="No claims" description="Submitted claims appear here." />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Employee</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Expense</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Receipt</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <p className="font-medium">{c.employeeName}</p>
                      <p className="text-xs text-muted-foreground">{c.employeeCode}</p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatDate(c.claimDate)}</TableCell>
                    <TableCell className="max-w-80">
                      <p>{CLAIM_CATEGORY_LABELS[c.category]}</p>
                      <p className="text-xs text-muted-foreground">{c.description}</p>
                      {c.decisionNote && <p className="text-xs text-muted-foreground">Note: {c.decisionNote}</p>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(c.amount)}</TableCell>
                    <TableCell>
                      {c.receiptFileId ? (
                        <a href={`/api/files/${c.receiptFileId}?inline=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          <Paperclip className="size-3.5" /> View
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={CLAIM_STATUS_BADGE[c.status]}>{CLAIM_STATUS_LABELS[c.status]}</Badge>
                      {c.paidRunId && seesRuns && (
                        <Link href={`/payroll/runs/${c.paidRunId}`} className="ml-2 text-xs text-primary hover:underline">
                          Run
                        </Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
