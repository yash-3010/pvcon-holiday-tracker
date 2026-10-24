"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
  BadgeCheck, Calculator, Check, CircleAlert, Download, Ellipsis, FileText, Pause, Play, Send, Undo2, Wallet, X,
} from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { PayslipStatusBadge, RunStatusBadge } from "@/components/payroll/run-status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { RUN_STATUS_LABELS, type RunStatus } from "@/lib/payroll/constants";
import { cn } from "@/lib/utils";
import type { RegisterRow, RunDetail } from "@/server/modules/payroll/queries";
import {
  approveRunAction, cancelRunAction, computeRunAction, markPaidAction, releasePayslipAction, releaseRunAction, revertRunAction,
  setPayslipStatusAction,
} from "../actions";
import { InputsCard } from "./inputs-card";
import { PayslipSheet } from "./payslip-sheet";

const STEPS: RunStatus[] = ["draft", "computed", "approved", "released", "paid"];

function Steps({ status }: { status: RunStatus }) {
  const current = STEPS.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {STEPS.map((step, i) => (
        <li key={step} className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full border text-xs",
              i < current && "border-primary bg-primary text-primary-foreground",
              i === current && "border-primary font-semibold text-primary",
              i > current && "text-muted-foreground",
            )}
          >
            {i < current ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn(i === current ? "font-medium" : "text-muted-foreground")}>{RUN_STATUS_LABELS[step]}</span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export interface RunRights {
  run: boolean;
  approve: boolean;
  release: boolean;
  revert: boolean;
  /** The viewer computed the run, so someone else must approve it. */
  isMaker: boolean;
}

export function RunClient({
  detail, title, people, inputComponents, today, rights,
}: {
  detail: RunDetail;
  title: string;
  people: { id: number; name: string; code: string }[];
  inputComponents: { id: number; code: string; name: string }[];
  today: string;
  rights: RunRights;
}) {
  const router = useRouter();
  const { run, rows, totals, inputs } = detail;
  const refresh = () => router.refresh();
  const [drill, setDrill] = useState<RegisterRow | null>(null);
  const [revertOpen, setRevertOpen] = useState(false);
  const [revertNote, setRevertNote] = useState("");
  const [paidOpen, setPaidOpen] = useState(false);
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState("");

  const compute = useServerAction(computeRunAction, {
    successMessage: (d) => `Computed ${d.payslips} payslip(s)${d.warnings ? `, ${d.warnings} warning(s)` : ""}`,
    onSuccess: refresh,
  });
  const approve = useServerAction(approveRunAction, { successMessage: "Run approved", onSuccess: refresh });
  const revert = useServerAction(revertRunAction, {
    successMessage: "Run reverted to computed",
    onSuccess: () => {
      setRevertOpen(false);
      refresh();
    },
  });
  const release = useServerAction(releaseRunAction, { successMessage: (d) => `Released ${d.released} payslip(s)`, onSuccess: refresh });
  const releaseOne = useServerAction(releasePayslipAction, { successMessage: "Payslip released", onSuccess: refresh });
  const paid = useServerAction(markPaidAction, {
    successMessage: "Run marked paid",
    onSuccess: () => {
      setPaidOpen(false);
      refresh();
    },
  });
  const cancel = useServerAction(cancelRunAction, { successMessage: "Run cancelled", onSuccess: () => router.push("/payroll/runs") });
  const setStatus = useServerAction(setPayslipStatusAction, { onSuccess: refresh });

  const editable = run.status === "draft" || run.status === "computed";
  const stale = run.status === "draft" && rows.length > 0;
  const withWarnings = rows.filter((r) => r.warnings.length > 0 || r.error).length;
  const flagged = rows.filter((r) => r.flagged).length;

  const columns: ColumnDef<RegisterRow>[] = [
    {
      id: "employee",
      header: "Employee",
      accessorFn: (r) => `${r.name} ${r.code}`,
      cell: ({ row }) => (
        <button type="button" className="text-left" onClick={() => setDrill(row.original)}>
          <span className="font-medium hover:underline">{row.original.name}</span>
          <span className="block text-xs text-muted-foreground">{row.original.code}</span>
        </button>
      ),
    },
    {
      id: "days",
      header: "Paid days",
      accessorFn: (r) => r.paidDays,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.paidDays}
          {row.original.lopDays > 0 && <span className="ml-1 text-xs text-warning">−{row.original.lopDays} LOP</span>}
        </span>
      ),
    },
    { id: "gross", header: "Gross", accessorFn: (r) => r.grossEarnings, cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.grossEarnings)}</span> },
    { id: "deductions", header: "Deductions", accessorFn: (r) => r.totalDeductions, cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.totalDeductions)}</span> },
    { id: "net", header: "Net pay", accessorFn: (r) => r.netPay, cell: ({ row }) => <span className="font-medium tabular-nums">{formatMoney(row.original.netPay)}</span> },
    {
      id: "variance",
      header: "vs last month",
      accessorFn: (r) => r.variancePct ?? 0,
      cell: ({ row }) => {
        const v = row.original.variancePct;
        if (v === null) return <span className="text-xs text-muted-foreground">New</span>;
        return (
          <span className={cn("tabular-nums text-xs", row.original.flagged ? "font-semibold text-warning" : "text-muted-foreground")}>
            {v > 0 ? "+" : ""}
            {v}%
          </span>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (r) => r.status,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <PayslipStatusBadge status={row.original.status} />
          {(row.original.warnings.length > 0 || row.original.error) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <CircleAlert aria-label="Warnings" className={cn("size-4", row.original.error ? "text-destructive" : "text-warning")} />
              </TooltipTrigger>
              <TooltipContent>{row.original.error ?? row.original.warnings.join(" · ")}</TooltipContent>
            </Tooltip>
          )}
          {row.original.releasedAt && <Badge variant="outline">Released</Badge>}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        const canHold = editable && rights.run;
        const canReleaseHeld = (run.status === "released" || run.status === "paid") && rights.release && r.status === "hold" && !r.releasedAt;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${r.name}`}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setDrill(r)}>
                <FileText /> View payslip
              </DropdownMenuItem>
              {canHold && (
                <>
                  <DropdownMenuSeparator />
                  {r.status !== "ok" && !r.error && (
                    <DropdownMenuItem onSelect={() => setStatus.run({ runId: run.id, employeeId: r.employeeId, status: "ok" })}>
                      <Play /> Include
                    </DropdownMenuItem>
                  )}
                  {r.status !== "hold" && !r.error && (
                    <DropdownMenuItem onSelect={() => setStatus.run({ runId: run.id, employeeId: r.employeeId, status: "hold" })}>
                      <Pause /> Hold
                    </DropdownMenuItem>
                  )}
                  {r.status !== "excluded" && (
                    <DropdownMenuItem onSelect={() => setStatus.run({ runId: run.id, employeeId: r.employeeId, status: "excluded" })}>
                      <X /> Exclude
                    </DropdownMenuItem>
                  )}
                </>
              )}
              {canReleaseHeld && (
                <DropdownMenuItem disabled={releaseOne.pending} onSelect={() => releaseOne.run({ payslipId: r.payslipId })}>
                  <Send /> Release payslip
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const approveButton = (
    <Button disabled={approve.pending || rights.isMaker || stale} onClick={() => approve.run({ id: run.id })}>
      {approve.pending ? <Spinner /> : <BadgeCheck />} Approve
    </Button>
  );

  return (
    <>
      <PageHeader title={title} description={run.notes ?? undefined} actions={<RunStatusBadge status={run.status} />} />
      <div className="space-y-6">
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
            <Steps status={run.status === "cancelled" ? "draft" : run.status} />
            <div className="flex flex-wrap gap-2">
              {editable && rights.run && (
                <Button variant={run.status === "draft" ? "default" : "outline"} disabled={compute.pending} onClick={() => compute.run({ id: run.id })}>
                  {compute.pending ? <Spinner /> : <Calculator />} {rows.length ? "Compute again" : "Compute"}
                </Button>
              )}
              {run.status === "computed" && rights.approve &&
                (rights.isMaker ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>{approveButton}</span>
                    </TooltipTrigger>
                    <TooltipContent>You computed this run; someone else must approve it.</TooltipContent>
                  </Tooltip>
                ) : (
                  approveButton
                ))}
              {run.status === "approved" && rights.release && (
                <ConfirmDialog
                  trigger={
                    <Button disabled={release.pending}>
                      {release.pending ? <Spinner /> : <Send />} Release payslips
                    </Button>
                  }
                  title="Release payslips?"
                  description={`${totals.included} payslip(s) will be frozen as PDFs and shown to employees, who are also emailed. Held payslips wait. Released payslips never change.`}
                  confirmLabel="Release"
                  onConfirm={() => release.run({ id: run.id })}
                />
              )}
              {run.status === "approved" && rights.revert && (
                <Button variant="outline" onClick={() => setRevertOpen(true)}>
                  <Undo2 /> Revert
                </Button>
              )}
              {run.status === "released" && rights.run && (
                <Button onClick={() => setPaidOpen(true)}>
                  <Wallet /> Mark paid
                </Button>
              )}
              {rights.run && rows.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline">
                      <Download /> Export
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <a href={`/api/payroll/runs/${run.id}/export?kind=register`}>Payroll register (XLSX)</a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={`/api/payroll/runs/${run.id}/export?kind=bank-xlsx`}>Bank advice (XLSX)</a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={`/api/payroll/runs/${run.id}/export?kind=bank-csv`}>Bank advice (CSV)</a>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {editable && rights.run && (
                <ConfirmDialog
                  trigger={
                    <Button variant="ghost" disabled={cancel.pending}>
                      Cancel run
                    </Button>
                  }
                  title="Cancel this run?"
                  description="Its payslips are deleted. Its inputs stay for the record; claims and loans go to the next run."
                  confirmLabel="Cancel run"
                  destructive
                  onConfirm={() => cancel.run({ id: run.id })}
                />
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Payslips" value={String(totals.included + totals.held)} hint={`${totals.held} held · ${totals.excluded} excluded`} />
          <Stat label="Gross pay" value={formatMoney(totals.grossEarnings)} />
          <Stat label="Deductions" value={formatMoney(totals.totalDeductions)} hint={`Employer contributions ${formatMoney(totals.employerContributions)}`} />
          <Stat label="Net pay" value={formatMoney(totals.netPay)} />
        </div>

        {run.status === "cancelled" && <Alert variant="warning" title="Cancelled">This run was cancelled.</Alert>}
        {stale && (
          <Alert variant="warning" title="Compute again">
            Inputs changed since the last compute. Compute the run again before it can be approved.
          </Alert>
        )}
        {editable && (run.warnings.length > 0 || withWarnings > 0 || flagged > 0) && (
          <Alert variant="warning" title="Review before approving">
            <ul className="list-disc pl-4">
              {run.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
              {withWarnings > 0 && <li>{withWarnings} payslip(s) have warnings or errors (marked in the register).</li>}
              {flagged > 0 && <li>{flagged} net pay(s) changed by more than the variance flag since last month.</li>}
            </ul>
          </Alert>
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          {detail.computedByName && run.computedAt && <span>Computed by {detail.computedByName}</span>}
          {detail.approvedByName && run.approvedAt && <span>Approved by {detail.approvedByName}</span>}
          {run.paidOn && (
            <span>
              Paid on {formatDate(run.paidOn)}
              {run.paymentRef ? ` · ${run.paymentRef}` : ""}
            </span>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Register</CardTitle>
            <CardDescription>Click a name for the payslip, its lines and how each was worked out.</CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing computed yet.</p>
            ) : (
              <DataTable columns={columns} data={rows} searchPlaceholder="Search employees…" />
            )}
          </CardContent>
        </Card>

        <InputsCard runId={run.id} inputs={inputs} editable={editable && rights.run} people={people} components={inputComponents} />
      </div>

      <PayslipSheet row={drill} onOpenChange={(open) => !open && setDrill(null)} />

      <Dialog open={revertOpen} onOpenChange={setRevertOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revert to computed?</DialogTitle>
            <DialogDescription>
              Unlocks the month&apos;s attendance, puts claims back to approved, removes loan repayments and unmarks comp-off payouts.
            </DialogDescription>
          </DialogHeader>
          <Field label="Why" htmlFor="revert-note" required>
            <Textarea id="revert-note" rows={2} value={revertNote} onChange={(e) => setRevertNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="destructive" disabled={revert.pending || revertNote.trim().length < 3} onClick={() => revert.run({ id: run.id, note: revertNote })}>
              {revert.pending && <Spinner />}
              Revert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paidOpen} onOpenChange={setPaidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark paid</DialogTitle>
            <DialogDescription>Record the bank transfer of this run.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Paid on" htmlFor="paid-on" required>
              <Input id="paid-on" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
            <Field label="Reference" htmlFor="paid-ref">
              <Input id="paid-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR or batch number" />
            </Field>
          </div>
          <DialogFooter>
            <Button disabled={paid.pending || !paidOn} onClick={() => paid.run({ id: run.id, paidOn, reference })}>
              {paid.pending && <Spinner />}
              Mark paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
