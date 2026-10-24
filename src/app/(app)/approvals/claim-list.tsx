"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { CLAIM_CATEGORY_LABELS } from "@/lib/payroll/constants";
import type { ClaimListItem } from "@/server/modules/payroll/queries";
import { decideClaimAction } from "./actions";

type Decision = { claim: ClaimListItem; decision: "approved" | "rejected" };

export function ClaimApprovalList({ claims, timeZone }: { claims: ClaimListItem[]; timeZone: string }) {
  const router = useRouter();
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const decide = useServerAction(decideClaimAction, {
    successMessage: (d) => (d.status === "approved" ? "Claim approved; it is paid with the next payroll" : "Claim rejected"),
    onSuccess: () => {
      setDeciding(null);
      setNote("");
      router.refresh();
    },
  });

  if (claims.length === 0) {
    return <EmptyState title="No pending claims" description="Expense claims from people who report to you appear here." />;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{claims.length} claim(s) waiting, oldest first. Approved claims are paid with the next payroll run.</p>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Employee</TableHead>
                <TableHead>Expense</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.map((c) => (
                <TableRow key={c.id} data-testid={`approval-claim-${c.id}`}>
                  <TableCell>
                    <Link href={`/org/employees/${c.employeeId}`} className="font-medium hover:underline">
                      {c.employeeName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {c.employeeCode}
                      {c.submittedAt && ` · sent ${formatDateTime(c.submittedAt, timeZone)}`}
                    </p>
                  </TableCell>
                  <TableCell className="max-w-72">
                    <p>
                      {CLAIM_CATEGORY_LABELS[c.category]} · {formatDate(c.claimDate)}
                    </p>
                    <p className="text-xs text-muted-foreground">{c.description}</p>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(c.amount)}</TableCell>
                  <TableCell>
                    {c.receiptFileId ? (
                      <a href={`/api/files/${c.receiptFileId}?inline=1`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
                        <Paperclip className="size-3.5" /> View
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setDeciding({ claim: c, decision: "rejected" })}>
                        Reject
                      </Button>
                      <Button size="sm" onClick={() => setDeciding({ claim: c, decision: "approved" })}>
                        Approve
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Dialog open={deciding !== null} onOpenChange={(open) => !open && setDeciding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deciding?.decision === "approved" ? "Approve this claim?" : "Reject this claim?"}</DialogTitle>
            <DialogDescription>
              {deciding &&
                `${deciding.claim.employeeName}: ${CLAIM_CATEGORY_LABELS[deciding.claim.category]} on ${formatDate(deciding.claim.claimDate)}, ${formatMoney(deciding.claim.amount)}.`}
            </DialogDescription>
          </DialogHeader>
          <Field label={deciding?.decision === "rejected" ? "Reason for the employee" : "Note (optional)"} htmlFor="claim-decision-note" required={deciding?.decision === "rejected"}>
            <Textarea id="claim-decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button
              variant={deciding?.decision === "rejected" ? "destructive" : "default"}
              disabled={decide.pending || (deciding?.decision === "rejected" && !note.trim())}
              onClick={() => deciding && decide.run({ id: deciding.claim.id, decision: deciding.decision, note })}
            >
              {decide.pending && <Spinner />}
              {deciding?.decision === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
