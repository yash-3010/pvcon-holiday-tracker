"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Ellipsis, Pencil, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { idOrNull } from "@/components/forms/select-values";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { designationSchema } from "@/lib/validation/org";
import type { DesignationListItem } from "@/server/modules/org/queries";
import { archiveDesignationAction, createDesignationAction, updateDesignationAction } from "./actions";

type FormInput = z.input<typeof designationSchema>;
type FormOutput = z.output<typeof designationSchema>;

function DesignationSheet({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: DesignationListItem | null;
}) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(designationSchema),
    values: { name: editing?.name ?? "", level: editing?.level ?? null },
  });
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createDesignationAction, { successMessage: "Designation created", onSuccess: done, onError });
  const update = useServerAction(updateDesignationAction, { successMessage: "Designation updated", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  const errors = form.formState.errors;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? "Edit designation" : "New designation"}</SheetTitle>
          <SheetDescription>Job titles. The optional level orders them from junior to senior.</SheetDescription>
        </SheetHeader>
        <form
          onSubmit={form.handleSubmit((values) => (editing ? update.run({ ...values, id: editing.id }) : create.run(values)))}
          className="flex flex-1 flex-col gap-4"
        >
          <Field label="Name" htmlFor="desig-name" error={errors.name?.message} required>
            <Input id="desig-name" {...form.register("name")} />
          </Field>
          <Field label="Level" htmlFor="desig-level" error={errors.level?.message} hint="0–99, optional">
            <Input id="desig-level" type="number" min={0} max={99} {...form.register("level", { setValueAs: idOrNull })} />
          </Field>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save designation" : "Create designation"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function DesignationsClient({ designations }: { designations: DesignationListItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DesignationListItem | null>(null);
  const archive = useServerAction(archiveDesignationAction, {
    successMessage: (d) => (d.archived ? "Designation archived" : "Designation restored"),
    onSuccess: () => router.refresh(),
  });
  const openSheet = (designation: DesignationListItem | null) => {
    setEditing(designation);
    setOpen(true);
  };

  const columns: ColumnDef<DesignationListItem>[] = [
    { accessorKey: "name", header: "Designation", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "level", header: "Level", accessorFn: (d) => d.level ?? "—" },
    { accessorKey: "employeeCount", header: "Employees" },
    {
      id: "status",
      header: "Status",
      accessorFn: (d) => (d.archived ? "Archived" : "Active"),
      cell: ({ row }) =>
        row.original.archived ? <Badge variant="secondary">Archived</Badge> : <Badge variant="success">Active</Badge>,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${row.original.name}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => openSheet(row.original)}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => archive.run({ id: row.original.id, archived: !row.original.archived })}>
              {row.original.archived ? <ArchiveRestore /> : <Archive />}
              {row.original.archived ? "Restore" : "Archive"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={designations}
        searchPlaceholder="Search designations…"
        toolbar={
          <Button onClick={() => openSheet(null)}>
            <Plus /> New designation
          </Button>
        }
      />
      <DesignationSheet open={open} onOpenChange={setOpen} editing={editing} />
    </>
  );
}
