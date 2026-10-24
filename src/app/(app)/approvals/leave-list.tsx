"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { useServerAction } from "@/components/forms/use-server-action";
import { formatLeaveRange } from "@/components/leave/format";
import { LeaveTypeTag } from "@/components/leave/leave-type-tag";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/dates";
import { formatDays } from "@/lib/leave";
import type { LeaveRequestView } from "@/server/modules/leave/queries";
import { bulkApproveLeaveAction, decideLeaveAction } from "./actions";

type Pending = LeaveRequestView & { balance: number; balanceAfter: number };
type Decision = { request: Pending; decision: "approved" | "rejected" };

export function LeaveApprovalList({ requests, timeZone }: { requests: Pending[]; timeZone: string }) {
  const router = useRouter();
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const decide = useServerAction(decideLeaveAction, {
    successMessage: (d) => (d.status === "approved" ? "Leave approved" : "Leave rejected"),
    onSuccess: () => {
      setDeciding(null);
      setNote("");
      router.refresh();
    },
  });
  const bulk = useServerAction(bulkApproveLeaveAction, {
    onSuccess: (d) => {
      if (d.failed.length) {
        toast.warning(`Approved ${d.approved}; ${d.failed.length} could not be approved`, {
          description: d.failed.map((f) => f.error).join(" "),
        });
      } else {
        toast.success(`Approved ${d.approved} request(s)`);
      }
      setSelected([]);
      router.refresh();
    },
  });

  if (requests.length === 0) {
    return <EmptyState title="No pending leave requests" description="Leave requests from people who report to you appear here." />;
  }
  const allSelected = selected.length === requests.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{requests.length} request(s) waiting, oldest first.</p>
        <Button size="sm" disabled={selected.length === 0 || bulk.pending} onClick={() => bulk.run({ requestIds: selected, note: null })}>
          {bulk.pending ? <Spinner /> : <CheckCheck />} Approve selected{selected.length ? ` (${selected.length})` : ""}
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={allSelected}
                    onCheckedChange={(checked) => setSelected(checked ? requests.map((r) => r.id) : [])}
                  />
                </TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Leave</TableHead>
                <TableHead>Days</TableHead>
                <TableHead>Balance</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="w-44" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id} data-testid={`approval-leave-${r.id}`}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${r.employeeName}'s request`}
                      checked={selected.includes(r.id)}
                      onCheckedChange={(checked) => setSelected((s) => (checked ? [...s, r.id] : s.filter((id) => id !== r.id)))}
                    />
                  </TableCell>
                  <TableCell>
                    <Link href={`/org/employees/${r.employeeId}?tab=leave`} className="font-medium hover:underline">
                      {r.employeeName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {r.employeeCode} · applied {formatDateTime(r.createdAt, timeZone)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <LeaveTypeTag code={r.leaveType.code} name={r.leaveType.name} color={r.leaveType.color} />
                    <p className="whitespace-nowrap text-xs text-muted-foreground">{formatLeaveRange(r)}</p>
                  </TableCell>
                  <TableCell className="tabular-nums">{r.days}</TableCell>
                  <TableCell className={r.balanceAfter < 0 ? "text-destructive" : "text-muted-foreground"}>
                    {formatDays(r.balance)} → {formatDays(r.balanceAfter)}
                  </TableCell>
                  <TableCell className="max-w-64 text-sm">
                    {r.reason ?? <span className="text-muted-foreground">—</span>}
                    {r.attachmentFileId && (
                      <a href={`/api/files/${r.attachmentFileId}`} className="ml-1 inline-flex items-center gap-0.5 text-xs text-primary hover:underline">
                        <Paperclip className="size-3" /> Document
                      </a>
                    )}
                  </TableCell>
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
            <DialogTitle>{deciding?.decision === "approved" ? "Approve this leave?" : "Reject this leave?"}</DialogTitle>
            <DialogDescription>
              {deciding &&
                `${deciding.request.employeeName}: ${formatDays(deciding.request.days)} of ${deciding.request.leaveType.name} on ${formatLeaveRange(deciding.request)}.`}
            </DialogDescription>
          </DialogHeader>
          <Field label={deciding?.decision === "rejected" ? "Reason for the employee (optional)" : "Note (optional)"} htmlFor="leave-decision-note">
            <Textarea id="leave-decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button
              variant={deciding?.decision === "rejected" ? "destructive" : "default"}
              disabled={decide.pending}
              onClick={() => deciding && decide.run({ requestId: deciding.request.id, decision: deciding.decision, note })}
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
