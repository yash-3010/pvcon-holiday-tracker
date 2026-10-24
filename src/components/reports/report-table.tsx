"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/dates";
import { formatDays } from "@/lib/leave";
import { formatMoney } from "@/lib/money";
import type { ReportColumn, ReportRow } from "@/server/modules/reports/types";

export function formatCell(column: ReportColumn, value: string | number | null): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return column.type === "date" ? formatDate(value) : value;
  switch (column.type) {
    case "money":
      return formatMoney(value);
    case "percent":
      return `${value}%`;
    case "minutes":
      return `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}`;
    case "days":
      return formatDays(value);
    default:
      return new Intl.NumberFormat("en-IN").format(value);
  }
}

const NUMERIC = new Set(["number", "money", "percent", "minutes", "days"]);

/** A report's rows, sortable and searchable. */
export function ReportTable({ columns, rows, emptyHint }: { columns: ReportColumn[]; rows: ReportRow[]; emptyHint?: string }) {
  // A wide report's empty row would centre its message off screen on a phone.
  if (!rows.length) return <EmptyState title="Nothing for these filters" description={emptyHint ?? "Try another period, department or person."} />;
  const defs: ColumnDef<ReportRow>[] = columns.map((c) => ({
    id: c.key,
    header: c.label,
    accessorFn: (row) => row[c.key] ?? null,
    sortUndefined: "last",
    cell: ({ row }) => (
      <span className={NUMERIC.has(c.type) ? "block text-right tabular-nums" : undefined}>{formatCell(c, row.original[c.key] ?? null)}</span>
    ),
  }));
  return <DataTable columns={defs} data={rows} pageSize={50} searchPlaceholder="Search rows…" />;
}
