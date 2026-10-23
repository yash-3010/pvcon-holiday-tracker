"use client";

import Link from "next/link";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Ellipsis, FolderOpen, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { formatHours, PROJECT_STATUS_BADGE, PROJECT_STATUS_LABELS } from "@/lib/timesheets";
import type { ProjectListItem } from "@/server/modules/projects/queries";
import { ProjectSheet, type ProjectSheetOptions } from "./project-sheet";

export function ProjectsClient({ projects, options, canManage }: { projects: ProjectListItem[]; options: ProjectSheetOptions; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectListItem | null>(null);
  const openSheet = (project: ProjectListItem | null) => {
    setEditing(project);
    setOpen(true);
  };
  const columns: ColumnDef<ProjectListItem>[] = [
    {
      id: "project",
      header: "Project",
      accessorFn: (p) => `${p.code} ${p.name}`,
      cell: ({ row }) => (
        <Link href={`/time/projects/${row.original.id}`} className="hover:underline">
          <p className="font-medium">{row.original.name}</p>
          <p className="text-xs text-muted-foreground">{row.original.code}</p>
        </Link>
      ),
    },
    { id: "client", header: "Client", accessorFn: (p) => p.clientName ?? "Internal" },
    {
      id: "status",
      header: "Status",
      accessorFn: (p) => PROJECT_STATUS_LABELS[p.status],
      cell: ({ row }) => <Badge variant={PROJECT_STATUS_BADGE[row.original.status]}>{PROJECT_STATUS_LABELS[row.original.status]}</Badge>,
    },
    { id: "manager", header: "Manager", accessorFn: (p) => p.managerName ?? "—" },
    { accessorKey: "members", header: "Members" },
    {
      id: "hours",
      header: "Booked hours",
      accessorFn: (p) => p.bookedMinutes,
      cell: ({ row }) => {
        const p = row.original;
        const over = p.budgetHours !== null && p.bookedMinutes > p.budgetHours * 60;
        return (
          <span className={over ? "font-medium text-destructive tabular-nums" : "tabular-nums"}>
            {formatHours(p.bookedMinutes)}
            {p.budgetHours !== null && <span className="text-muted-foreground"> / {p.budgetHours}</span>}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${row.original.code}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/time/projects/${row.original.id}`}>
                <FolderOpen /> Open
              </Link>
            </DropdownMenuItem>
            {canManage && (
              <DropdownMenuItem onSelect={() => openSheet(row.original)}>
                <Pencil /> Edit
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
  return (
    <>
      <DataTable
        columns={columns}
        data={projects}
        searchPlaceholder="Search projects…"
        toolbar={
          canManage && (
            <Button onClick={() => openSheet(null)}>
              <Plus /> New project
            </Button>
          )
        }
      />
      {canManage && <ProjectSheet open={open} onOpenChange={setOpen} editing={editing} options={options} />}
    </>
  );
}
