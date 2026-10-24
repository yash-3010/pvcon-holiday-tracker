"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Ellipsis, Pencil, Plus } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { categorySchema } from "@/lib/validation/timesheets";
import type { TaskCategoryRow } from "@/server/db/schema";
import { archiveCategoryAction, createCategoryAction, updateCategoryAction } from "./actions";

type Values = z.output<typeof categorySchema>;

function CategorySheet({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (open: boolean) => void; editing: TaskCategoryRow | null }) {
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(categorySchema),
    values: { name: editing?.name ?? "", billableDefault: editing?.billableDefault ?? true },
  });
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createCategoryAction, { successMessage: "Category created", onSuccess: done, onError });
  const update = useServerAction(updateCategoryAction, { successMessage: "Category updated", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? "Edit task category" : "New task category"}</SheetTitle>
          <SheetDescription>What kind of work time was spent on. A row is billable when its project and its category both are, by default.</SheetDescription>
        </SheetHeader>
        <form
          onSubmit={form.handleSubmit((values) => (editing ? update.run({ ...values, id: editing.id }) : create.run(values)))}
          className="flex flex-1 flex-col gap-4"
        >
          <Field label="Name" htmlFor="category-name" error={form.formState.errors.name?.message} required>
            <Input id="category-name" {...form.register("name")} />
          </Field>
          <div className="flex items-center gap-2">
            <Controller
              control={form.control}
              name="billableDefault"
              render={({ field }) => <Switch id="category-billable" checked={field.value} onCheckedChange={field.onChange} />}
            />
            <Label htmlFor="category-billable">Billable by default</Label>
          </div>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save category" : "Create category"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function CategoriesClient({ categories }: { categories: TaskCategoryRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TaskCategoryRow | null>(null);
  const archive = useServerAction(archiveCategoryAction, {
    successMessage: (d) => (d.archived ? "Category archived" : "Category restored"),
    onSuccess: () => router.refresh(),
  });
  const openSheet = (category: TaskCategoryRow | null) => {
    setEditing(category);
    setOpen(true);
  };
  const columns: ColumnDef<TaskCategoryRow>[] = [
    { accessorKey: "name", header: "Category", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    {
      id: "billable",
      header: "Billable by default",
      accessorFn: (c) => (c.billableDefault ? "Yes" : "No"),
      cell: ({ row }) => (row.original.billableDefault ? <Badge variant="info">Billable</Badge> : <Badge variant="secondary">Not billable</Badge>),
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (c) => (c.archived ? "Archived" : "Active"),
      cell: ({ row }) => (row.original.archived ? <Badge variant="secondary">Archived</Badge> : <Badge variant="success">Active</Badge>),
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
        data={categories}
        searchPlaceholder="Search categories…"
        toolbar={
          <Button onClick={() => openSheet(null)}>
            <Plus /> New category
          </Button>
        }
      />
      <CategorySheet open={open} onOpenChange={setOpen} editing={editing} />
    </>
  );
}
