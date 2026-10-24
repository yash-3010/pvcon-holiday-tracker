"use client";

import { useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { History, Pencil } from "lucide-react";
import { ReviseSalarySheet, type ReviseTarget } from "@/components/payroll/revise-salary-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { formatPeriod } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { SalaryListItem, StructureOption } from "@/server/modules/payroll/queries";

export function SalariesClient({
  salaries, structures, period, canManage,
}: { salaries: SalaryListItem[]; structures: StructureOption[]; period: string; canManage: boolean }) {
  const [target, setTarget] = useState<ReviseTarget | null>(null);
  const [open, setOpen] = useState(false);
  const revise = (s: SalaryListItem) => {
    setTarget({
      employeeId: s.employeeId, name: s.name, joinedMonth: s.dateOfJoining.slice(0, 7),
      current: s.annualCtc !== null && s.structureId !== null ? { annualCtc: s.annualCtc, structureId: s.structureId, overrides: s.overrides } : null,
    });
    setOpen(true);
  };
  const columns: ColumnDef<SalaryListItem>[] = [
    {
      id: "employee",
      header: "Employee",
      accessorFn: (s) => `${s.name} ${s.code}`,
      cell: ({ row }) => (
        <div>
          <Link href={`/org/employees/${row.original.employeeId}?tab=salary`} className="font-medium hover:underline">
            {row.original.name}
          </Link>
          <p className="text-xs text-muted-foreground">{row.original.code}</p>
        </div>
      ),
    },
    {
      id: "structure",
      header: "Structure",
      accessorFn: (s) => s.structure ?? "",
      cell: ({ row }) => row.original.structure ?? <Badge variant="warning">No salary</Badge>,
    },
    {
      id: "annual",
      header: "Annual CTC",
      accessorFn: (s) => s.annualCtc ?? -1,
      cell: ({ row }) => (row.original.annualCtc === null ? "—" : <span className="tabular-nums">{formatMoney(row.original.annualCtc)}</span>),
    },
    {
      id: "monthly",
      header: "Monthly",
      accessorFn: (s) => s.annualCtc ?? -1,
      cell: ({ row }) =>
        row.original.annualCtc === null ? "—" : <span className="tabular-nums text-muted-foreground">{formatMoney(Math.round(row.original.annualCtc / 12))}</span>,
    },
    {
      id: "from",
      header: "Since",
      accessorFn: (s) => s.effectiveFrom ?? "",
      cell: ({ row }) => (row.original.effectiveFrom ? formatPeriod(row.original.effectiveFrom.slice(0, 7)) : "—"),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/org/employees/${row.original.employeeId}?tab=salary`}>
              <History /> History
            </Link>
          </Button>
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => revise(row.original)}>
              <Pencil /> {row.original.annualCtc === null ? "Assign" : "Revise"}
            </Button>
          )}
        </div>
      ),
    },
  ];
  return (
    <>
      <DataTable columns={columns} data={salaries} searchPlaceholder="Search employees…" />
      <ReviseSalarySheet open={open} onOpenChange={setOpen} target={target} structures={structures} defaultMonth={period} />
    </>
  );
}
