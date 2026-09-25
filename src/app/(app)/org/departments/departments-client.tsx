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
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import type { SelectOption } from "@/lib/hr";
import { departmentSchema } from "@/lib/validation/org";
import type { DepartmentListItem } from "@/server/modules/org/queries";
import { archiveDepartmentAction, createDepartmentAction, updateDepartmentAction } from "./actions";

type FormInput = z.input<typeof departmentSchema>;
type FormOutput = z.output<typeof departmentSchema>;

function DepartmentSheet({
  open,
  onOpenChange,
  editing,
  parentOptions,
  headOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: DepartmentListItem | null;
  parentOptions: SelectOption[];
  headOptions: SelectOption[];
}) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(departmentSchema),
    values: {
      name: editing?.name ?? "",
      code: editing?.code ?? "",
      parentId: editing?.parentId ?? null,
      headEmployeeId: editing?.headEmployeeId ?? null,
    },
  });
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createDepartmentAction, { successMessage: "Department created", onSuccess: done, onError });
  const update = useServerAction(updateDepartmentAction, { successMessage: "Department updated", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  const errors = form.formState.errors;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? "Edit department" : "New department"}</SheetTitle>
          <SheetDescription>Departments can sit under a parent department.</SheetDescription>
        </SheetHeader>
        <form
          onSubmit={form.handleSubmit((values) => (editing ? update.run({ ...values, id: editing.id }) : create.run(values)))}
          className="flex flex-1 flex-col gap-4"
        >
          <Field label="Name" htmlFor="dept-name" error={errors.name?.message} required>
            <Input id="dept-name" {...form.register("name")} />
          </Field>
          <Field label="Code" htmlFor="dept-code" error={errors.code?.message} hint="Optional short code, e.g. ENG">
            <Input id="dept-code" {...form.register("code")} />
          </Field>
          <Field label="Parent department" htmlFor="dept-parent" error={errors.parentId?.message}>
            <NativeSelect id="dept-parent" {...form.register("parentId", { setValueAs: idOrNull })}>
              <option value="">None</option>
              {parentOptions
                .filter((o) => o.id !== editing?.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Head" htmlFor="dept-head" error={errors.headEmployeeId?.message}>
            <NativeSelect id="dept-head" {...form.register("headEmployeeId", { setValueAs: idOrNull })}>
              <option value="">None</option>
              {headOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save department" : "Create department"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function DepartmentsClient({
  departments,
  parentOptions,
  headOptions,
}: {
  departments: DepartmentListItem[];
  parentOptions: SelectOption[];
  headOptions: SelectOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentListItem | null>(null);
  const archive = useServerAction(archiveDepartmentAction, {
    successMessage: (d) => (d.archived ? "Department archived" : "Department restored"),
    onSuccess: () => router.refresh(),
  });
  const openSheet = (department: DepartmentListItem | null) => {
    setEditing(department);
    setOpen(true);
  };

  const columns: ColumnDef<DepartmentListItem>[] = [
    {
      id: "name",
      header: "Department",
      accessorFn: (d) => `${d.name} ${d.code ?? ""}`,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          {row.original.code && <p className="text-xs text-muted-foreground">{row.original.code}</p>}
        </div>
      ),
    },
    { id: "parent", header: "Parent", accessorFn: (d) => d.parentName ?? "—" },
    { id: "head", header: "Head", accessorFn: (d) => d.headName ?? "—" },
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
        data={departments}
        searchPlaceholder="Search departments…"
        toolbar={
          <Button onClick={() => openSheet(null)}>
            <Plus /> New department
          </Button>
        }
      />
      <DepartmentSheet open={open} onOpenChange={setOpen} editing={editing} parentOptions={parentOptions} headOptions={headOptions} />
    </>
  );
}
