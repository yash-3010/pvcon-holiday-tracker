"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { RunStatusBadge } from "@/components/payroll/run-status-badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { formatPeriod } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { RUN_TYPE_LABELS, type RunType } from "@/lib/payroll/constants";
import type { RunListItem } from "@/server/modules/payroll/queries";
import { createRunAction } from "./actions";

function CreateRunDialog({ open, onOpenChange, suggestedPeriod, maxPeriod }: { open: boolean; onOpenChange: (open: boolean) => void; suggestedPeriod: string; maxPeriod: string }) {
  const router = useRouter();
  const [period, setPeriod] = useState(suggestedPeriod);
  const [type, setType] = useState<RunType>("regular");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const { run, pending } = useServerAction(createRunAction, {
    successMessage: "Run created",
    onSuccess: ({ id }) => router.push(`/payroll/runs/${id}`),
    onError: (r) => setErrors(r.fieldErrors ?? {}),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New payroll run</DialogTitle>
          <DialogDescription>A regular run pays a month&apos;s salaries; the previous month must be approved first.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            void run({ period, type, notes });
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Month" htmlFor="run-period" error={errors.period?.[0]} required>
              <Input id="run-period" type="month" max={maxPeriod} value={period} onChange={(e) => setPeriod(e.target.value)} required />
            </Field>
            <Field label="Type" htmlFor="run-type" error={errors.type?.[0]}>
              <NativeSelect id="run-type" value={type} onChange={(e) => setType(e.target.value as RunType)}>
                <option value="regular">Regular</option>
                <option value="off_cycle">Off-cycle (inputs only)</option>
              </NativeSelect>
            </Field>
          </div>
          <Field label="Notes" htmlFor="run-notes" error={errors.notes?.[0]}>
            <Input id="run-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Create run
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RunsClient({ runs, canCreate, suggestedPeriod, maxPeriod }: { runs: RunListItem[]; canCreate: boolean; suggestedPeriod: string; maxPeriod: string }) {
  const [open, setOpen] = useState(false);
  const columns: ColumnDef<RunListItem>[] = [
    {
      id: "period",
      header: "Month",
      accessorFn: (r) => r.period,
      cell: ({ row }) => (
        <Link href={`/payroll/runs/${row.original.id}`} className="font-medium hover:underline">
          {formatPeriod(row.original.period)}
        </Link>
      ),
    },
    { id: "type", header: "Type", accessorFn: (r) => RUN_TYPE_LABELS[r.type] },
    { id: "status", header: "Status", accessorFn: (r) => r.status, cell: ({ row }) => <RunStatusBadge status={row.original.status} /> },
    { accessorKey: "payslips", header: "Payslips" },
    {
      id: "net",
      header: "Net pay",
      accessorFn: (r) => r.netPay,
      cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.netPay)}</span>,
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        data={runs}
        searchPlaceholder="Search runs…"
        toolbar={
          canCreate && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> New run
            </Button>
          )
        }
      />
      {canCreate && <CreateRunDialog key={String(open)} open={open} onOpenChange={setOpen} suggestedPeriod={suggestedPeriod} maxPeriod={maxPeriod} />}
    </>
  );
}
