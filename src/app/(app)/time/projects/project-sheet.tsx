"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { idOrNull } from "@/components/forms/select-values";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import type { SelectOption } from "@/lib/hr";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from "@/lib/timesheets";
import { projectSchema } from "@/lib/validation/timesheets";
import type { ProjectRow } from "@/server/db/schema";
import { createProjectAction, updateProjectAction } from "./actions";

type FormInput = z.input<typeof projectSchema>;
type FormOutput = z.output<typeof projectSchema>;

export interface ProjectSheetOptions {
  clients: SelectOption[];
  employees: SelectOption[];
}

export function ProjectSheet({
  open, onOpenChange, editing, options,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ProjectRow | null;
  options: ProjectSheetOptions;
}) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(projectSchema),
    values: {
      name: editing?.name ?? "", code: editing?.code ?? "", clientId: editing?.clientId ?? null, billableDefault: editing?.billableDefault ?? true,
      status: editing?.status ?? "active", startDate: editing?.startDate ?? "", endDate: editing?.endDate ?? "",
      budgetHours: editing?.budgetHours ?? null, managerEmployeeId: editing?.managerEmployeeId ?? null,
    },
  });
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createProjectAction, { successMessage: "Project created", onSuccess: done, onError });
  const update = useServerAction(updateProjectAction, { successMessage: "Project saved", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  const errors = form.formState.errors;
  // Keep a client or manager that is no longer offered selectable on the project that already has it.
  const clients = editing?.clientId && !options.clients.some((c) => c.id === editing.clientId)
    ? [...options.clients, { id: editing.clientId, label: "(archived client)" }]
    : options.clients;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editing ? `Edit ${editing.code}` : "New project"}</SheetTitle>
          <SheetDescription>Internal projects (no client) are open to everyone; client projects only to their members.</SheetDescription>
        </SheetHeader>
        <form
          onSubmit={form.handleSubmit((values) => (editing ? update.run({ ...values, id: editing.id }) : create.run(values)))}
          className="flex flex-1 flex-col gap-4"
        >
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <Field label="Code" htmlFor="project-code" error={errors.code?.message} required>
              <Input id="project-code" {...form.register("code")} />
            </Field>
            <Field label="Name" htmlFor="project-name" error={errors.name?.message} required>
              <Input id="project-name" {...form.register("name")} />
            </Field>
          </div>
          <Field label="Client" htmlFor="project-client" error={errors.clientId?.message}>
            <NativeSelect id="project-client" {...form.register("clientId", { setValueAs: idOrNull })}>
              <option value="">Internal (open to everyone)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status" htmlFor="project-status" error={errors.status?.message}>
              <NativeSelect id="project-status" {...form.register("status")}>
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {PROJECT_STATUS_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Budget (hours)" htmlFor="project-budget" error={errors.budgetHours?.message}>
              <Input id="project-budget" type="number" min={1} {...form.register("budgetHours", { setValueAs: idOrNull })} />
            </Field>
            <Field label="Starts" htmlFor="project-start" error={errors.startDate?.message}>
              <Input id="project-start" type="date" {...form.register("startDate")} />
            </Field>
            <Field label="Ends" htmlFor="project-end" error={errors.endDate?.message}>
              <Input id="project-end" type="date" {...form.register("endDate")} />
            </Field>
          </div>
          <Field label="Project manager" htmlFor="project-manager" error={errors.managerEmployeeId?.message}>
            <NativeSelect id="project-manager" {...form.register("managerEmployeeId", { setValueAs: idOrNull })}>
              <option value="">None</option>
              {options.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex items-center gap-2">
            <Controller
              control={form.control}
              name="billableDefault"
              render={({ field }) => <Switch id="project-billable" checked={field.value} onCheckedChange={field.onChange} />}
            />
            <Label htmlFor="project-billable">Billable by default</Label>
          </div>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save project" : "Create project"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
