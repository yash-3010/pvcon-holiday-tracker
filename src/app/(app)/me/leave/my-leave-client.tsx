"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Paperclip } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { ApplyLeaveSheet, type ApplyLeaveContext } from "@/components/leave/apply-leave-sheet";
import { formatLeaveRange } from "@/components/leave/format";
import { LeaveStatusBadge } from "@/components/leave/leave-status-badge";
import { LeaveTypeTag } from "@/components/leave/leave-type-tag";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { dayOfWeek, formatDate } from "@/lib/dates";
import { WEEKDAY_LABELS, formatDays } from "@/lib/leave";
import { applyLeaveSchema } from "@/lib/validation/leave";
import type { HolidayRow } from "@/server/db/schema";
import type { OptionalPick } from "@/server/modules/holidays/service";
import type { LeaveRequestView } from "@/server/modules/leave/queries";
import { applyLeaveAction, cancelLeaveAction, toggleOptionalHolidayAction, withdrawLeaveAction } from "./actions";

type MyRequest = LeaveRequestView & { canWithdraw: boolean; canCancel: boolean };

export function ApplyLeaveButton({ context }: { context: ApplyLeaveContext }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={context.types.length === 0}>
        <CalendarPlus /> Apply for leave
      </Button>
      <ApplyLeaveSheet open={open} onOpenChange={setOpen} context={context} schema={applyLeaveSchema} action={applyLeaveAction} />
    </>
  );
}

function CancelDialog({ request, onClose }: { request: MyRequest | null; onClose: () => void }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const { run, pending } = useServerAction(cancelLeaveAction, {
    successMessage: "Leave cancelled; the days are back in your balance",
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
          <DialogTitle>Cancel this leave?</DialogTitle>
          <DialogDescription>
            {request && `${formatDays(request.days)} of ${request.leaveType.name} on ${formatLeaveRange(request)} go back to your balance.`}
          </DialogDescription>
        </DialogHeader>
        <Field label="Note for your manager (optional)" htmlFor="cancel-note">
          <Textarea id="cancel-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => request && run({ requestId: request.id, note })}>
            {pending && <Spinner />}
            Cancel leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MyRequests({ requests, year }: { requests: MyRequest[]; year: string }) {
  const router = useRouter();
  const [cancelling, setCancelling] = useState<MyRequest | null>(null);
  const withdraw = useServerAction(withdrawLeaveAction, { successMessage: "Request withdrawn", onSuccess: () => router.refresh() });

  if (requests.length === 0) {
    return <EmptyState title={`No leave requests in ${year}`} description="Requests you apply for appear here with their status." />;
  }
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Type</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Days</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((r) => (
              <TableRow key={r.id} data-testid={`leave-request-${r.id}`}>
                <TableCell>
                  <LeaveTypeTag code={r.leaveType.code} name={r.leaveType.name} color={r.leaveType.color} />
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatLeaveRange(r)}</TableCell>
                <TableCell className="tabular-nums">{r.days}</TableCell>
                <TableCell>
                  <LeaveStatusBadge status={r.status} />
                </TableCell>
                <TableCell className="max-w-72 text-xs text-muted-foreground">
                  {[
                    r.reason,
                    r.approverName && r.status !== "pending" && r.status !== "withdrawn" ? `Decided by ${r.approverName}` : null,
                    r.decisionNote ? `“${r.decisionNote}”` : null,
                    r.cancelNote ? `Cancelled: ${r.cancelNote}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {r.attachmentFileId && (
                    <a href={`/api/files/${r.attachmentFileId}`} className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline">
                      <Paperclip className="size-3" /> Document
                    </a>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {r.canWithdraw && (
                    <Button size="sm" variant="outline" disabled={withdraw.pending} onClick={() => withdraw.run({ requestId: r.id })}>
                      Withdraw
                    </Button>
                  )}
                  {r.canCancel && (
                    <Button size="sm" variant="outline" onClick={() => setCancelling(r)}>
                      Cancel
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <CancelDialog request={cancelling} onClose={() => setCancelling(null)} />
    </Card>
  );
}

export function MyHolidays({
  year, holidays, picks, allowed,
}: { year: number; holidays: HolidayRow[]; picks: OptionalPick[]; allowed: number }) {
  const router = useRouter();
  const toggle = useServerAction(toggleOptionalHolidayAction, {
    successMessage: (d) => (d.selected ? "Optional holiday picked" : "Optional holiday removed"),
    onSuccess: () => router.refresh(),
  });
  const pickById = new Map(picks.map((p) => [p.holidayId, p]));
  const used = picks.filter((p) => p.selected).length;

  if (holidays.length === 0) return <EmptyState title={`No holidays published for ${year}`} description="HR hasn't added this year's holidays yet." />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Holidays {year}</CardTitle>
        <CardDescription>
          {picks.length > 0
            ? `You have picked ${used} of ${allowed} optional holiday(s). Picks lock once the date has passed.`
            : "Fixed holidays apply to everyone."}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Date</TableHead>
              <TableHead>Day</TableHead>
              <TableHead>Holiday</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Take it</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {holidays.map((h) => {
              const pick = pickById.get(h.id);
              const atLimit = !pick?.selected && used >= allowed;
              return (
                <TableRow key={h.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(h.date)}</TableCell>
                  <TableCell className="text-muted-foreground">{WEEKDAY_LABELS[dayOfWeek(h.date)]}</TableCell>
                  <TableCell className="font-medium">{h.name}</TableCell>
                  <TableCell>
                    <Badge variant={h.type === "fixed" ? "default" : "info"}>{h.type === "fixed" ? "Fixed" : "Optional"}</Badge>
                  </TableCell>
                  <TableCell>
                    {pick ? (
                      <Switch
                        aria-label={`Take ${h.name} off`}
                        checked={pick.selected}
                        disabled={pick.locked || atLimit || toggle.pending}
                        onCheckedChange={(selected) => toggle.run({ holidayId: h.id, selected })}
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">Everyone</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
