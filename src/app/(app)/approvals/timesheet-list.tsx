"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Eye, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useServerAction } from "@/components/forms/use-server-action";
import { WeekGrid, type GridRow } from "@/components/timesheets/week-grid";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, type ISODate } from "@/lib/dates";
import { formatHours, weekRangeLabel } from "@/lib/timesheets";
import type { PendingTimesheet, WeekDetail } from "@/server/modules/timesheets/queries";
import { bulkApproveTimesheetsAction, decideTimesheetAction, timesheetDetailAction } from "./actions";

type Decision = { timesheet: PendingTimesheet; decision: "approved" | "rejected" };

const gridRows = (week: WeekDetail): GridRow[] =>
  week.rows.map((r) => ({
    key: `${r.projectId}:${r.taskCategoryId}`, projectCode: r.projectCode, projectName: r.projectName, clientName: r.clientName,
    categoryName: r.categoryName, billable: r.billable, notes: r.notes,
    hours: Object.fromEntries(Object.entries(r.minutes).map(([d, m]) => [d, formatHours(m)])),
  }));

function WeekSheet({ open, onClose, loading, detail, today }: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  detail: { employeeName: string; week: WeekDetail } | null;
  today: ISODate;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="max-w-5xl sm:max-w-5xl">
        <SheetHeader>
          <SheetTitle>{detail ? detail.employeeName : "Loading…"}</SheetTitle>
          <SheetDescription>{detail && `Week of ${weekRangeLabel(detail.week.weekStart)}`}</SheetDescription>
        </SheetHeader>
        {loading && !detail ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : detail ? (
          <WeekGrid days={detail.week.days} rows={gridRows(detail.week)} today={today} editable={false} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function TimesheetApprovalList({ timesheets, timeZone, today }: { timesheets: PendingTimesheet[]; timeZone: string; today: ISODate }) {
  const router = useRouter();
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [viewing, setViewing] = useState(false);
  const [detail, setDetail] = useState<{ employeeName: string; week: WeekDetail } | null>(null);
  const load = useServerAction(timesheetDetailAction, { onSuccess: setDetail });
  const decide = useServerAction(decideTimesheetAction, {
    successMessage: (d) => (d.status === "approved" ? "Timesheet approved" : "Timesheet returned to the employee"),
    onSuccess: () => {
      setDeciding(null);
      setNote("");
      router.refresh();
    },
  });
  const bulk = useServerAction(bulkApproveTimesheetsAction, {
    onSuccess: (d) => {
      if (d.failed.length) toast.warning(`Approved ${d.approved}; ${d.failed.length} could not be approved`, { description: d.failed.map((f) => f.error).join(" ") });
      else toast.success(`Approved ${d.approved} timesheet(s)`);
      setSelected([]);
      router.refresh();
    },
  });
  const view = (id: number) => {
    setDetail(null);
    setViewing(true);
    void load.run({ timesheetId: id });
  };

  if (timesheets.length === 0) {
    return <EmptyState title="No timesheets waiting" description="Weekly timesheets from people who report to you appear here once submitted." />;
  }
  const allSelected = selected.length === timesheets.length;
  const rejecting = deciding?.decision === "rejected";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{timesheets.length} timesheet(s) waiting, oldest first.</p>
        <Button size="sm" disabled={selected.length === 0 || bulk.pending} onClick={() => bulk.run({ timesheetIds: selected, note: null })}>
          {bulk.pending ? <Spinner /> : <CheckCheck />} Approve selected{selected.length ? ` (${selected.length})` : ""}
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox aria-label="Select all" checked={allSelected} onCheckedChange={(c) => setSelected(c ? timesheets.map((t) => t.id) : [])} />
                </TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Week</TableHead>
                <TableHead className="text-right">Logged / available</TableHead>
                <TableHead className="text-right">Billable</TableHead>
                <TableHead>Checks</TableHead>
                <TableHead className="w-60" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {timesheets.map((t) => (
                <TableRow key={t.id} data-testid={`approval-timesheet-${t.id}`}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${t.employeeName}'s timesheet`}
                      checked={selected.includes(t.id)}
                      onCheckedChange={(c) => setSelected((s) => (c ? [...s, t.id] : s.filter((x) => x !== t.id)))}
                    />
                  </TableCell>
                  <TableCell>
                    <Link href={`/org/employees/${t.employeeId}?tab=timesheets`} className="font-medium hover:underline">
                      {t.employeeName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {t.employeeCode}
                      {t.submittedAt && ` · submitted ${formatDateTime(t.submittedAt, timeZone)}`}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{weekRangeLabel(t.weekStart)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatHours(t.loggedMinutes)} <span className="text-muted-foreground">/ {formatHours(t.availableMinutes)} h</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatHours(t.billableMinutes)} h</TableCell>
                  <TableCell className="text-xs">
                    {t.flaggedDays > 0 && (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <TriangleAlert className="size-3" /> {t.flaggedDays} day(s) differ from attendance
                      </span>
                    )}
                    {t.leaveDays > 0 && <p className="text-muted-foreground">{t.leaveDays} day(s) of leave</p>}
                    {t.flaggedDays === 0 && t.leaveDays === 0 && <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => view(t.id)} aria-label={`View ${t.employeeName}'s week`}>
                        <Eye /> View
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDeciding({ timesheet: t, decision: "rejected" })}>
                        Reject
                      </Button>
                      <Button size="sm" onClick={() => setDeciding({ timesheet: t, decision: "approved" })}>
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
      <WeekSheet open={viewing} onClose={() => setViewing(false)} loading={load.pending} detail={detail} today={today} />
      <Dialog open={deciding !== null} onOpenChange={(open) => !open && setDeciding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{rejecting ? "Return this timesheet?" : "Approve this timesheet?"}</DialogTitle>
            <DialogDescription>
              {deciding &&
                `${deciding.timesheet.employeeName}: ${formatHours(deciding.timesheet.loggedMinutes)} h in the week of ${weekRangeLabel(deciding.timesheet.weekStart)}.`}
              {rejecting && " The employee can change it and submit it again."}
            </DialogDescription>
          </DialogHeader>
          <Field label={rejecting ? "What needs fixing" : "Note (optional)"} htmlFor="timesheet-decision-note" required={rejecting}>
            <Textarea id="timesheet-decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button
              variant={rejecting ? "destructive" : "default"}
              disabled={decide.pending || (rejecting && note.trim().length < 3)}
              onClick={() => deciding && decide.run({ timesheetId: deciding.timesheet.id, decision: deciding.decision, note })}
            >
              {decide.pending && <Spinner />}
              {rejecting ? "Return" : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
