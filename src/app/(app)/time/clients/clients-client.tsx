"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Ellipsis, Pencil, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { clientSchema } from "@/lib/validation/timesheets";
import type { ClientListItem } from "@/server/modules/projects/queries";
import { archiveClientAction, createClientAction, updateClientAction } from "./actions";

type FormInput = z.input<typeof clientSchema>;
type FormOutput = z.output<typeof clientSchema>;

function ClientSheet({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (open: boolean) => void; editing: ClientListItem | null }) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(clientSchema),
    values: { name: editing?.name ?? "", code: editing?.code ?? "" },
  });
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createClientAction, { successMessage: "Client created", onSuccess: done, onError });
  const update = useServerAction(updateClientAction, { successMessage: "Client updated", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  const errors = form.formState.errors;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? "Edit client" : "New client"}</SheetTitle>
          <SheetDescription>Projects for a client are open only to their members.</SheetDescription>
        </SheetHeader>
        <form
          onSubmit={form.handleSubmit((values) => (editing ? update.run({ ...values, id: editing.id }) : create.run(values)))}
          className="flex flex-1 flex-col gap-4"
        >
          <Field label="Name" htmlFor="client-name" error={errors.name?.message} required>
            <Input id="client-name" {...form.register("name")} />
          </Field>
          <Field label="Code" htmlFor="client-code" error={errors.code?.message} hint="Optional short code, e.g. ACME">
            <Input id="client-code" {...form.register("code")} />
          </Field>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save client" : "Create client"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function ClientsClient({ clients }: { clients: ClientListItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClientListItem | null>(null);
  const archive = useServerAction(archiveClientAction, {
    successMessage: (d) => (d.archived ? "Client archived" : "Client restored"),
    onSuccess: () => router.refresh(),
  });
  const openSheet = (client: ClientListItem | null) => {
    setEditing(client);
    setOpen(true);
  };
  const columns: ColumnDef<ClientListItem>[] = [
    {
      id: "name",
      header: "Client",
      accessorFn: (c) => `${c.name} ${c.code ?? ""}`,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          {row.original.code && <p className="text-xs text-muted-foreground">{row.original.code}</p>}
        </div>
      ),
    },
    { accessorKey: "projects", header: "Projects" },
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
        data={clients}
        searchPlaceholder="Search clients…"
        toolbar={
          <Button onClick={() => openSheet(null)}>
            <Plus /> New client
          </Button>
        }
      />
      <ClientSheet open={open} onOpenChange={setOpen} editing={editing} />
    </>
  );
}
