"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AttendanceStatusBadge } from "@/components/attendance/status-badge";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime, formatHm, formatMinutes } from "@/lib/dates";
import type { PendingRegularization } from "@/server/modules/attendance/queries";
import { decideRegularizationAction } from "./actions";

type Decision = { request: PendingRegularization; decision: "approved" | "rejected" };

const span = (a: number | null, b: number | null) => (a === null && b === null ? "no punches" : `${a === null ? "—" : formatHm(a)}–${b === null ? "—" : formatHm(b)}`);

export function RegularizationApprovalList({ requests, timeZone }: { requests: PendingRegularization[]; timeZone: string }) {
  const router = useRouter();
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const decide = useServerAction(decideRegularizationAction, {
    successMessage: (d) => (d.status === "approved" ? "Correction approved; the day is recomputed" : "Correction rejected"),
    onSuccess: () => {
      setDeciding(null);
      setNote("");
      router.refresh();
    },
  });

  if (requests.length === 0) {
    return <EmptyState title="No pending corrections" description="Attendance corrections from people who report to you appear here." />;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{requests.length} correction(s) waiting, oldest first. Approved times replace the day&apos;s punches.</p>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Employee</TableHead>
                <TableHead>Day</TableHead>
                <TableHead>Recorded</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id} data-testid={`approval-regularization-${r.id}`}>
                  <TableCell>
                    <Link href={`/org/employees/${r.employeeId}?tab=attendance`} className="font-medium hover:underline">
                      {r.employeeName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {r.employeeCode} · asked {formatDateTime(r.createdAt, timeZone)}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(r.date, { weekday: "short", day: "2-digit", month: "short" })}</TableCell>
                  <TableCell>
                    {r.actual ? (
                      <div className="space-y-0.5">
                        <AttendanceStatusBadge status={r.actual.status} />
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {span(r.actual.firstIn, r.actual.lastOut)}
                          {r.actual.workedMinutes > 0 && ` · ${formatMinutes(r.actual.workedMinutes)}`}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not recorded</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium tabular-nums">
                    {formatHm(r.requestedIn)}–{formatHm(r.requestedOut)}
                    <p className="text-xs font-normal text-muted-foreground">{formatMinutes(r.requestedOut - r.requestedIn)}</p>
                  </TableCell>
                  <TableCell className="max-w-64 text-sm">{r.reason}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => setDeciding({ request: r, decision: "rejected" })}>
                        Reject
                      </Button>
                      <Button size="sm" onClick={() => setDeciding({ request: r, decision: "approved" })}>
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
            <DialogTitle>{deciding?.decision === "approved" ? "Approve this correction?" : "Reject this correction?"}</DialogTitle>
            <DialogDescription>
              {deciding &&
                `${deciding.request.employeeName}: ${formatDate(deciding.request.date, { weekday: "long", day: "numeric", month: "long" })}, ${formatHm(deciding.request.requestedIn)}–${formatHm(deciding.request.requestedOut)}.`}
            </DialogDescription>
          </DialogHeader>
          <Field label={deciding?.decision === "rejected" ? "Reason for the employee (optional)" : "Note (optional)"} htmlFor="reg-decision-note">
            <Textarea id="reg-decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button
              variant={deciding?.decision === "rejected" ? "destructive" : "default"}
              disabled={decide.pending}
              onClick={() => deciding && decide.run({ id: deciding.request.id, decision: deciding.decision, note })}
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
