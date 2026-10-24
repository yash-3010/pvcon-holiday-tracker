"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { CircleCheck, Ellipsis, ListOrdered, Pause, Play, Plus } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPeriod } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { LoanStatus, LoanType } from "@/lib/payroll/constants";
import type { LoanListItem } from "@/server/modules/payroll/queries";
import { createLoanAction, setLoanStatusAction } from "./actions";

type Loan = LoanListItem & { repayments: { period: string; amount: number; runId: number }[] };
const STATUS_BADGE: Record<LoanStatus, "success" | "warning" | "secondary"> = { active: "success", paused: "warning", closed: "secondary" };
const STATUS_LABEL: Record<LoanStatus, string> = { active: "Active", paused: "Paused", closed: "Closed" };
const TYPE_LABEL: Record<LoanType, string> = { loan: "Loan", advance: "Salary advance" };

function NewLoanDialog({ open, onOpenChange, employees, thisMonth }: { open: boolean; onOpenChange: (open: boolean) => void; employees: { id: number; label: string }[]; thisMonth: string }) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? 0);
  const [type, setType] = useState<LoanType>("loan");
  const [principal, setPrincipal] = useState("");
  const [emi, setEmi] = useState("");
  const [startPeriod, setStartPeriod] = useState(thisMonth);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const { run, pending } = useServerAction(createLoanAction, {
    successMessage: "Loan added",
    onSuccess: () => {
      onOpenChange(false);
      router.refresh();
    },
    onError: (r) => setErrors(r.fieldErrors ?? {}),
  });
  const months = Number(principal) > 0 && Number(emi) > 0 ? Math.ceil(Number(principal) / Number(emi)) : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New loan or advance</DialogTitle>
          <DialogDescription>The EMI is deducted in each regular run from the start month.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            void run({ employeeId, type, principal: Number(principal), emi: Number(emi), startPeriod, note });
          }}
          className="space-y-4"
        >
          <Field label="Employee" htmlFor="loan-employee" error={errors.employeeId?.[0]}>
            <NativeSelect id="loan-employee" value={employeeId} onChange={(e) => setEmployeeId(Number(e.target.value))}>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="loan-type">
              <NativeSelect id="loan-type" value={type} onChange={(e) => setType(e.target.value as LoanType)}>
                <option value="loan">Loan</option>
                <option value="advance">Salary advance</option>
              </NativeSelect>
            </Field>
            <Field label="First EMI month" htmlFor="loan-start" error={errors.startPeriod?.[0]}>
              <Input id="loan-start" type="month" value={startPeriod} onChange={(e) => setStartPeriod(e.target.value)} required />
            </Field>
            <Field label="Amount (₹)" htmlFor="loan-principal" error={errors.principal?.[0]} required>
              <Input id="loan-principal" type="number" step="0.01" min={1} value={principal} onChange={(e) => setPrincipal(e.target.value)} required />
            </Field>
            <Field label="EMI (₹ a month)" htmlFor="loan-emi" error={errors.emi?.[0]} required hint={months ? `About ${months} month(s)` : undefined}>
              <Input id="loan-emi" type="number" step="0.01" min={1} value={emi} onChange={(e) => setEmi(e.target.value)} required />
            </Field>
          </div>
          <Field label="Note" htmlFor="loan-note" error={errors.note?.[0]}>
            <Input id="loan-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending || !employees.length}>
              {pending && <Spinner />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LoansClient({ loans, employees, thisMonth }: { loans: Loan[]; employees: { id: number; label: string }[]; thisMonth: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [statement, setStatement] = useState<Loan | null>(null);
  const setStatus = useServerAction(setLoanStatusAction, { successMessage: (d) => `Loan ${d.status}`, onSuccess: () => router.refresh() });
  const columns: ColumnDef<Loan>[] = [
    {
      id: "employee",
      header: "Employee",
      accessorFn: (l) => `${l.employeeName} ${l.employeeCode}`,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.employeeName}</p>
          <p className="text-xs text-muted-foreground">
            {TYPE_LABEL[row.original.type]}
            {row.original.note ? ` · ${row.original.note}` : ""}
          </p>
        </div>
      ),
    },
    { id: "principal", header: "Amount", accessorFn: (l) => l.principal, cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.principal)}</span> },
    {
      id: "emi",
      header: "EMI",
      accessorFn: (l) => l.emi,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatMoney(row.original.emi)} <span className="text-xs text-muted-foreground">from {formatPeriod(row.original.startPeriod)}</span>
        </span>
      ),
    },
    { id: "repaid", header: "Repaid", accessorFn: (l) => l.repaid, cell: ({ row }) => <span className="tabular-nums">{formatMoney(row.original.repaid)}</span> },
    {
      id: "outstanding",
      header: "Outstanding",
      accessorFn: (l) => l.outstanding,
      cell: ({ row }) => <span className="font-medium tabular-nums">{formatMoney(row.original.outstanding)}</span>,
    },
    { id: "status", header: "Status", accessorFn: (l) => l.status, cell: ({ row }) => <Badge variant={STATUS_BADGE[row.original.status]}>{STATUS_LABEL[row.original.status]}</Badge> },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => {
        const l = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${l.employeeName}'s ${TYPE_LABEL[l.type].toLowerCase()}`}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setStatement(l)}>
                <ListOrdered /> Statement
              </DropdownMenuItem>
              {l.status === "active" && (
                <DropdownMenuItem onSelect={() => setStatus.run({ id: l.id, status: "paused" })}>
                  <Pause /> Pause
                </DropdownMenuItem>
              )}
              {l.status !== "active" && l.outstanding > 0 && (
                <DropdownMenuItem onSelect={() => setStatus.run({ id: l.id, status: "active" })}>
                  <Play /> Resume
                </DropdownMenuItem>
              )}
              {l.status !== "closed" && (
                <DropdownMenuItem onSelect={() => setStatus.run({ id: l.id, status: "closed" })}>
                  <CircleCheck /> Close{l.outstanding > 0 ? " (write off the rest)" : ""}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        data={loans}
        searchPlaceholder="Search loans…"
        toolbar={
          <Button onClick={() => setOpen(true)}>
            <Plus /> New loan
          </Button>
        }
      />
      <NewLoanDialog key={String(open)} open={open} onOpenChange={setOpen} employees={employees} thisMonth={thisMonth} />
      <Sheet open={!!statement} onOpenChange={(o) => !o && setStatement(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Statement · {statement?.employeeName}</SheetTitle>
            <SheetDescription>
              {statement && `${TYPE_LABEL[statement.type]} of ${formatMoney(statement.principal)}, EMI ${formatMoney(statement.emi)}.`}
            </SheetDescription>
          </SheetHeader>
          {statement && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Repaid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statement.repayments.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{formatPeriod(r.period)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>Outstanding</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(statement.outstanding)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
