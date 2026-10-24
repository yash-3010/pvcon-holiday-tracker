"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { CompOffResolution } from "@/lib/attendance";
import { formatDate, formatDateTime, formatMinutes } from "@/lib/dates";
import { formatDays } from "@/lib/leave";
import type { CompOffClaimView } from "@/server/modules/compoff/queries";
import { decideCompOffAction } from "./actions";

type Decision = { claim: CompOffClaimView; decision: "approved" | "rejected"; resolution: CompOffResolution };

const TITLES = {
  leave: "Approve as comp-off leave?",
  payout: "Approve as a payout?",
  rejected: "Reject this claim?",
} as const;

export function CompOffApprovalList({ claims, payoutEnabled, timeZone }: { claims: CompOffClaimView[]; payoutEnabled: boolean; timeZone: string }) {
  const router = useRouter();
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const decide = useServerAction(decideCompOffAction, {
    successMessage: (d) => (d.status === "approved" ? "Comp-off approved" : "Claim rejected"),
    onSuccess: () => {
      setDeciding(null);
      setNote("");
      router.refresh();
    },
  });

  if (claims.length === 0) {
    return <EmptyState title="No pending comp-off claims" description="Claims for work on weekly offs and holidays appear here." />;
  }
  const kind = deciding ? (deciding.decision === "rejected" ? "rejected" : deciding.resolution) : "leave";
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{claims.length} claim(s) waiting, oldest first.</p>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Employee</TableHead>
                <TableHead>Day worked</TableHead>
                <TableHead>Worked</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-56" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {claims.map((c) => (
                <TableRow key={c.id} data-testid={`approval-compoff-${c.id}`}>
                  <TableCell>
                    <Link href={`/org/employees/${c.employeeId}?tab=attendance`} className="font-medium hover:underline">
                      {c.employeeName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {c.employeeCode} · claimed {formatDateTime(c.createdAt, timeZone)}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(c.workedDate, { weekday: "short", day: "2-digit", month: "short" })}</TableCell>
                  <TableCell className="tabular-nums">{formatMinutes(c.workedMinutes)}</TableCell>
                  <TableCell className="tabular-nums">{c.daysRequested}</TableCell>
                  <TableCell className="max-w-64 text-sm">{c.reason ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setDeciding({ claim: c, decision: "rejected", resolution: "leave" })}>
                        Reject
                      </Button>
                      {payoutEnabled && (
                        <Button size="sm" variant="outline" onClick={() => setDeciding({ claim: c, decision: "approved", resolution: "payout" })}>
                          Pay out
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setDeciding({ claim: c, decision: "approved", resolution: "leave" })}>
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
            <DialogTitle>{TITLES[kind]}</DialogTitle>
            <DialogDescription>
              {deciding &&
                `${deciding.claim.employeeName}: ${formatDays(deciding.claim.daysRequested)} for ${formatMinutes(deciding.claim.workedMinutes)} worked on ${formatDate(deciding.claim.workedDate, { weekday: "long", day: "numeric", month: "long" })}.`}
              {kind === "payout" && " Payroll pays it with the next salary."}
            </DialogDescription>
          </DialogHeader>
          <Field label={kind === "rejected" ? "Reason for the employee (optional)" : "Note (optional)"} htmlFor="compoff-decision-note">
            <Textarea id="compoff-decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button
              variant={kind === "rejected" ? "destructive" : "default"}
              disabled={decide.pending}
              onClick={() =>
                deciding && decide.run({ claimId: deciding.claim.id, decision: deciding.decision, resolution: deciding.resolution, note })
              }
            >
              {decide.pending && <Spinner />}
              {kind === "rejected" ? "Reject" : kind === "payout" ? "Approve payout" : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
