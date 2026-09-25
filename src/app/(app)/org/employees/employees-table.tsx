"use client";

import Link from "next/link";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { filterEmployees, type StatusFilter } from "@/components/employees/filters";
import { EmployeeStatusBadge } from "@/components/employees/status-badge";
import { DataTable } from "@/components/ui/data-table";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate } from "@/lib/dates";
import { EMPLOYEE_STATUS_LABELS, EMPLOYEE_STATUSES, type SelectOption } from "@/lib/hr";
import type { EmployeeListItem } from "@/server/modules/employees/queries";

const columns: ColumnDef<EmployeeListItem>[] = [
  {
    id: "employee",
    header: "Employee",
    accessorFn: (e) => `${e.displayName} ${e.employeeCode} ${e.workEmail ?? ""}`,
    cell: ({ row }) => (
      <Link href={`/org/employees/${row.original.id}`} className="block min-w-0 hover:underline">
        <span className="font-medium">{row.original.displayName}</span>
        <span className="block text-xs text-muted-foreground">
          {row.original.employeeCode}
          {row.original.workEmail ? ` · ${row.original.workEmail}` : ""}
        </span>
      </Link>
    ),
  },
  { id: "department", header: "Department", accessorFn: (e) => e.departmentName ?? "—" },
  { id: "designation", header: "Designation", accessorFn: (e) => e.designationName ?? "—" },
  { id: "manager", header: "Manager", accessorFn: (e) => e.managerName ?? "—" },
  {
    id: "status",
    header: "Status",
    accessorFn: (e) => EMPLOYEE_STATUS_LABELS[e.status],
    cell: ({ row }) => <EmployeeStatusBadge status={row.original.status} />,
  },
  { id: "joined", header: "Joined", accessorFn: (e) => e.dateOfJoining, cell: ({ row }) => formatDate(row.original.dateOfJoining) },
];

export function EmployeesTable({ rows, departments }: { rows: EmployeeListItem[]; departments: SelectOption[] }) {
  const [status, setStatus] = useState<StatusFilter>("current");
  const [departmentId, setDepartmentId] = useState("");
  const data = filterEmployees(rows, { status, departmentId: departmentId ? Number(departmentId) : null });
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search name, code or email…"
      emptyMessage="No employees match these filters."
      toolbar={
        <div className="flex flex-wrap gap-2">
          <div className="w-40">
            <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="current">Current</option>
              <option value="all">All</option>
              {EMPLOYEE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {EMPLOYEE_STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="w-48">
            <NativeSelect aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      }
    />
  );
}
