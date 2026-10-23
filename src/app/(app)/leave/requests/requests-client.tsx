"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardPen, Paperclip } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { ApplyLeaveSheet, type ApplyLeaveContext } from "@/components/leave/apply-leave-sheet";
import { formatLeaveRange } from "@/components/leave/format";
import { LeaveStatusBadge } from "@/components/leave/leave-status-badge";
import { LeaveTypeTag } from "@/components/leave/leave-type-tag";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { LEAVE_STATUS_LABELS, formatDays } from "@/lib/leave";
import type { SelectOption } from "@/lib/hr";
import { applyOnBehalfSchema } from "@/lib/validation/leave";
import type { LeaveRequestView } from "@/server/modules/leave/queries";
import { cancelLeaveAction } from "../../me/leave/actions";
import { recordLeaveAction } from "./actions";

export function RecordLeaveButton({ context, employees }: { context: ApplyLeaveContext; employees: SelectOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={employees.length === 0}>
        <ClipboardPen /> Record leave
      </Button>
      <ApplyLeaveSheet
        open={open}
        onOpenChange={setOpen}
        context={context}
        schema={applyOnBehalfSchema}
        action={recordLeaveAction}
        employeePicker={{ options: employees }}
        title="Record leave"
        description="For leave already agreed or taken, e.g. sick leave reported by phone. It is approved at once; notice and length limits don't apply, but the balance does. The preview uses company holidays; the employee's optional holidays apply on save."
        submitLabel="Record leave"
        successMessage="Leave recorded"
      />
    </>
  );
}

function CancelDialog({ request, onClose }: { request: LeaveRequestView | null; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const { run, pending } = useServerAction(cancelLeaveAction, {
    successMessage: "Leave cancelled and the days returned",
    onSuccess: () => {
      setNote("");
      onClose();
      router.refresh();
    },
  });
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {request?.employeeName}&apos;s leave?</DialogTitle>
          <DialogDescription>
            {request && `${formatDays(request.days)} of ${request.leaveType.name} on ${formatLeaveRange(request)} go back to their balance, and they are notified.`}
          </DialogDescription>
        </DialogHeader>
        <Field label="Reason" htmlFor="hr-cancel-note" required hint="Shown to the employee and kept in the audit log.">
          <Textarea id="hr-cancel-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="destructive" disabled={pending || note.trim().length < 3} onClick={() => request && run({ requestId: request.id, note })}>
            {pending && <Spinner />}
            Cancel leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LeaveRequestsTable({ requests, canCancel }: { requests: LeaveRequestView[]; canCancel: boolean }) {
  const [cancelling, setCancelling] = useState<LeaveRequestView | null>(null);
  const columns: ColumnDef<LeaveRequestView>[] = [
    {
      id: "employee",
      header: "Employee",
      accessorFn: (r) => `${r.employeeName} ${r.employeeCode}`,
      cell: ({ row }) => (
        <div>
          <Link href={`/org/employees/${row.original.employeeId}?tab=leave`} className="font-medium hover:underline">
            {row.original.employeeName}
          </Link>
          <p className="text-xs text-muted-foreground">{row.original.employeeCode}</p>
        </div>
      ),
    },
    {
      id: "type",
      header: "Type",
      accessorFn: (r) => r.leaveType.code,
      cell: ({ row }) => <LeaveTypeTag code={row.original.leaveType.code} name={row.original.leaveType.name} color={row.original.leaveType.color} />,
    },
    { id: "dates", header: "Dates", accessorFn: (r) => r.startDate, cell: ({ row }) => <span className="whitespace-nowrap">{formatLeaveRange(row.original)}</span> },
    { accessorKey: "days", header: "Days" },
    {
      id: "status",
      header: "Status",
      accessorFn: (r) => LEAVE_STATUS_LABELS[r.status],
      cell: ({ row }) => <LeaveStatusBadge status={row.original.status} />,
    },
    { id: "approver", header: "Decided by", accessorFn: (r) => r.approverName ?? "—" },
    {
      id: "notes",
      header: "Notes",
      enableSorting: false,
      accessorFn: (r) => [r.reason, r.decisionNote, r.cancelNote].filter(Boolean).join(" · "),
      cell: ({ row, getValue }) => (
        <span className="text-xs text-muted-foreground">
          {getValue<string>()}
          {row.original.attachmentFileId && (
            <a href={`/api/files/${row.original.attachmentFileId}`} className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline">
              <Paperclip className="size-3" /> Document
            </a>
          )}
        </span>
      ),
    },
    ...(canCancel
      ? [
          {
            id: "actions",
            header: "",
            enableSorting: false,
            cell: ({ row }) =>
              row.original.status === "approved" ? (
                <Button size="sm" variant="outline" onClick={() => setCancelling(row.original)}>
                  Cancel
                </Button>
              ) : null,
          } satisfies ColumnDef<LeaveRequestView>,
        ]
      : []),
  ];

  return (
    <>
      <DataTable columns={columns} data={requests} searchPlaceholder="Search by name, code or type…" emptyMessage="No leave requests match these filters." />
      <CancelDialog request={cancelling} onClose={() => setCancelling(null)} />
    </>
  );
}
