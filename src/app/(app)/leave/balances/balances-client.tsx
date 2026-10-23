"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { SlidersHorizontal } from "lucide-react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { LeaveTypeTag } from "@/components/leave/leave-type-tag";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/dates";
import type { SelectOption } from "@/lib/hr";
import { LEDGER_KIND_LABELS, formatDays } from "@/lib/leave";
import { adjustmentSchema } from "@/lib/validation/leave";
import type { BalanceSheet, LeaveTypeTag as TypeTag, LedgerEntryView } from "@/server/modules/leave/queries";
import { adjustBalanceAction, employeeLedgerAction } from "./actions";

type Row = BalanceSheet["rows"][number];
type FormInput = z.input<typeof adjustmentSchema>;
type FormOutput = z.output<typeof adjustmentSchema>;
type Target = { employeeId: number; leaveTypeId: number };

function AdjustSheet({
  open, onOpenChange, year, employees, types, target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  year: number;
  employees: SelectOption[];
  types: TypeTag[];
  target: Target | null;
}) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(adjustmentSchema),
    values: {
      employeeId: target?.employeeId ?? employees[0]?.id ?? 0,
      leaveTypeId: target?.leaveTypeId ?? types[0]?.id ?? 0,
      year,
      delta: 1,
      note: "",
    },
  });
  const { run, pending } = useServerAction(adjustBalanceAction, {
    successMessage: (d) => `Balance adjusted; it is now ${formatDays(d.balance)}`,
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Adjust a balance</SheetTitle>
          <SheetDescription>
            Adds or removes days with a note, e.g. leave taken before the system or a one-off grant. It shows in the employee&apos;s
            ledger and the audit log.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={form.handleSubmit((values) => run(values))} className="flex flex-1 flex-col gap-4">
          <Field label="Employee" htmlFor="adj-employee" error={errors.employeeId?.message} required>
            <NativeSelect id="adj-employee" {...form.register("employeeId", { valueAsNumber: true })}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Leave type" htmlFor="adj-type" error={errors.leaveTypeId?.message} required>
              <NativeSelect id="adj-type" {...form.register("leaveTypeId", { valueAsNumber: true })}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Leave year" htmlFor="adj-year" error={errors.year?.message} required>
              <Input id="adj-year" type="number" {...form.register("year", { valueAsNumber: true })} />
            </Field>
          </div>
          <Field label="Days" htmlFor="adj-delta" error={errors.delta?.message} hint="Positive adds days, negative removes them; steps of 0.5." required>
            <Input id="adj-delta" type="number" step={0.5} {...form.register("delta", { valueAsNumber: true })} />
          </Field>
          <Field label="Reason" htmlFor="adj-note" error={errors.note?.message} required>
            <Textarea id="adj-note" rows={3} {...form.register("note")} />
          </Field>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Adjust balance
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function LedgerDialog({
  cell, entries, onClose, year, canAdjust, onAdjust, employeesCanAdjust,
}: {
  cell: { row: Row; type: TypeTag } | null;
  employeesCanAdjust: (employeeId: number) => boolean;
  entries: LedgerEntryView[] | null;
  onClose: () => void;
  year: number;
  canAdjust: boolean;
  onAdjust: (target: Target) => void;
}) {
  const withBalance = (entries ?? []).reduce<(LedgerEntryView & { running: number })[]>(
    (rows, e) => [...rows, { ...e, running: (rows.at(-1)?.running ?? 0) + e.delta }],
    [],
  );
  return (
    <Dialog open={cell !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {cell?.row.employee.name} · {cell?.type.name} {year}
          </DialogTitle>
          <DialogDescription>Every credit and debit, oldest first. The balance is their sum.</DialogDescription>
        </DialogHeader>
        {entries === null ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No entries for this leave year.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>By / note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {withBalance.map((e) => {
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap">{formatDate(e.date)}</TableCell>
                      <TableCell>{LEDGER_KIND_LABELS[e.kind]}</TableCell>
                      <TableCell className={`text-right tabular-nums ${e.delta < 0 ? "text-destructive" : ""}`}>
                        {e.delta > 0 ? "+" : ""}
                        {e.delta}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{Math.round(e.running * 100) / 100}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{[e.createdByName, e.note].filter(Boolean).join(" · ")}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {canAdjust && cell && employeesCanAdjust(cell.row.employee.id) && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onAdjust({ employeeId: cell.row.employee.id, leaveTypeId: cell.type.id })}>
              <SlidersHorizontal /> Adjust this balance
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function BalancesClient({
  sheet, year, canAdjust, employees,
}: { sheet: BalanceSheet; year: number; canAdjust: boolean; employees: SelectOption[] }) {
  const [cell, setCell] = useState<{ row: Row; type: TypeTag } | null>(null);
  const [entries, setEntries] = useState<LedgerEntryView[] | null>(null);
  const ledger = useServerAction(employeeLedgerAction, { onSuccess: setEntries });
  const openLedger = (row: Row, type: TypeTag) => {
    setCell({ row, type });
    setEntries(null);
    ledger.run({ employeeId: row.employee.id, leaveTypeId: type.id, year });
  };
  const [adjusting, setAdjusting] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const openAdjust = (t: Target | null) => {
    setTarget(t);
    setCell(null);
    setAdjusting(true);
  };

  const columns: ColumnDef<Row>[] = [
    {
      id: "employee",
      header: "Employee",
      accessorFn: (r) => `${r.employee.name} ${r.employee.code} ${r.employee.department ?? ""}`,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.employee.name}</p>
          <p className="text-xs text-muted-foreground">
            {row.original.employee.code}
            {row.original.employee.department ? ` · ${row.original.employee.department}` : ""}
          </p>
        </div>
      ),
    },
    ...sheet.types.map(
      (type): ColumnDef<Row> => ({
        id: `type-${type.id}`,
        header: () => <LeaveTypeTag code={type.code} name={type.name} color={type.color} />,
        accessorFn: (r) => r.balances[type.id]?.balance ?? 0,
        cell: ({ row }) => {
          const b = row.original.balances[type.id]!;
          return (
            <button
              type="button"
              className="rounded-md px-2 py-1 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => openLedger(row.original, type)}
              aria-label={`${row.original.employee.name} ${type.code} ledger`}
            >
              <span className={`tabular-nums ${b.balance < 0 ? "text-destructive" : ""}`}>{Math.round(b.balance * 100) / 100}</span>
              {(b.used > 0 || b.pending > 0) && (
                <span className="block text-xs text-muted-foreground">
                  {[b.used ? `${b.used} used` : null, b.pending ? `${b.pending} pending` : null].filter(Boolean).join(" · ")}
                </span>
              )}
            </button>
          );
        },
      }),
    ),
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={sheet.rows}
        searchPlaceholder="Search employees…"
        emptyMessage="No current employees."
        toolbar={
          canAdjust ? (
            <Button onClick={() => openAdjust(null)} disabled={employees.length === 0}>
              <SlidersHorizontal /> Adjust a balance
            </Button>
          ) : undefined
        }
      />
      <LedgerDialog
        cell={cell}
        entries={entries}
        onClose={() => setCell(null)}
        year={year}
        canAdjust={canAdjust}
        onAdjust={openAdjust}
        employeesCanAdjust={(id) => employees.some((e) => e.id === id)}
      />
      {canAdjust && (
        <AdjustSheet open={adjusting} onOpenChange={setAdjusting} year={year} employees={employees} types={sheet.types} target={target} />
      )}
    </>
  );
}
