"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Ellipsis, Pencil, Plus } from "lucide-react";
import { Controller, useForm, useWatch, type Control, type FieldPath } from "react-hook-form";
import type { z } from "zod";
import { idOrNull } from "@/components/forms/select-values";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { LeaveTypeTag } from "@/components/leave/leave-type-tag";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES } from "@/lib/hr";
import { LEAVE_ACCRUAL_LABELS, LEAVE_ACCRUALS, formatDays } from "@/lib/leave";
import { leaveTypeSchema } from "@/lib/validation/leave";
import type { LeaveTypeRow } from "@/server/db/schema";
import { archiveLeaveTypeAction, createLeaveTypeAction, updateLeaveTypeAction } from "./actions";

type FormInput = z.input<typeof leaveTypeSchema>;
type FormOutput = z.output<typeof leaveTypeSchema>;

const BLANK: FormInput = {
  code: "", name: "", color: "#2563eb", paid: true, isLop: false, accrual: "upfront", annualQuota: 0, carryForwardMax: 0,
  encashable: false, allowHalfDay: true, allowNegative: false, maxConsecutiveDays: null, minNoticeDays: 0,
  attachmentAfterDays: null, countWeekends: false, applicableEmploymentTypes: null,
};

function toForm(t: LeaveTypeRow): FormInput {
  return {
    code: t.code, name: t.name, color: t.color, paid: t.paid, isLop: t.isLop, accrual: t.accrual, annualQuota: t.annualQuota,
    carryForwardMax: t.carryForwardMax, encashable: t.encashable, allowHalfDay: t.allowHalfDay, allowNegative: t.allowNegative,
    maxConsecutiveDays: t.maxConsecutiveDays, minNoticeDays: t.minNoticeDays, attachmentAfterDays: t.attachmentAfterDays,
    countWeekends: t.countWeekends, applicableEmploymentTypes: t.applicableEmploymentTypes,
  };
}

const SWITCHES: { name: FieldPath<FormInput>; label: string; hint: string }[] = [
  { name: "paid", label: "Paid", hint: "Turn off for unpaid leave." },
  { name: "isLop", label: "Loss of pay", hint: "Payroll deducts these days." },
  { name: "allowHalfDay", label: "Half days allowed", hint: "Employees can take a morning or an afternoon." },
  { name: "allowNegative", label: "Can go below zero", hint: "No balance check, e.g. leave without pay." },
  { name: "countWeekends", label: "Count weekly offs and holidays", hint: "Sandwich rule: off days inside a request count." },
  { name: "encashable", label: "Encashable", hint: "Paid out at exit (from the payroll release)." },
];

function SwitchRow({ control, name, label, hint }: { control: Control<FormInput>; name: FieldPath<FormInput>; label: string; hint: string }) {
  const id = `lt-${name}`;
  return (
    <div className="flex items-start gap-3">
      <Controller
        control={control}
        name={name}
        render={({ field }) => <Switch id={id} checked={field.value === true} onCheckedChange={field.onChange} className="mt-0.5" />}
      />
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function LeaveTypeSheet({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (open: boolean) => void; editing: LeaveTypeRow | null }) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(leaveTypeSchema),
    values: editing ? toForm(editing) : BLANK,
  });
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createLeaveTypeAction, { successMessage: "Leave type created", onSuccess: done, onError });
  const update = useServerAction(updateLeaveTypeAction, { successMessage: "Leave type updated", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  const errors = form.formState.errors;
  const system = editing?.isCompOff === true;
  const accrual = useWatch({ control: form.control, name: "accrual" });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editing ? `Edit ${editing.name}` : "New leave type"}</SheetTitle>
          <SheetDescription>
            {system
              ? "Comp-off is credited when approved off-day work is claimed, so its code and credits are fixed."
              : "Balances are kept per leave year. Changes apply to new requests and the next grants."}
          </SheetDescription>
        </SheetHeader>
        <form
          onSubmit={form.handleSubmit((values) => (editing ? update.run({ ...values, id: editing.id }) : create.run(values)))}
          className="flex flex-1 flex-col gap-4"
        >
          <div className="grid grid-cols-[1fr_2fr_auto] gap-3">
            <Field label="Code" htmlFor="lt-code" error={errors.code?.message} required>
              {system ? (
                <p id="lt-code" className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm">{editing.code}</p>
              ) : (
                <Input id="lt-code" className="uppercase" {...form.register("code")} />
              )}
            </Field>
            <Field label="Name" htmlFor="lt-name" error={errors.name?.message} required>
              <Input id="lt-name" {...form.register("name")} />
            </Field>
            <Field label="Colour" htmlFor="lt-color" error={errors.color?.message}>
              <Input id="lt-color" type="color" className="w-14 p-1" {...form.register("color")} />
            </Field>
          </div>

          {system ? (
            <p className="text-sm text-muted-foreground">Credits: approved comp-off claims only.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Credits" htmlFor="lt-accrual" error={errors.accrual?.message}>
                <NativeSelect id="lt-accrual" {...form.register("accrual")}>
                  {LEAVE_ACCRUALS.map((a) => (
                    <option key={a} value={a}>
                      {LEAVE_ACCRUAL_LABELS[a]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label="Days per leave year"
                htmlFor="lt-quota"
                error={errors.annualQuota?.message}
                hint={accrual === "monthly" ? "Credited a twelfth at a time" : accrual === "upfront" ? "Pro-rated for joiners" : undefined}
              >
                <Input id="lt-quota" type="number" step={0.5} min={0} readOnly={accrual === "none"} {...form.register("annualQuota", { valueAsNumber: true })} />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Carry forward up to" htmlFor="lt-carry" error={errors.carryForwardMax?.message} hint="Days; the rest lapses">
              <Input id="lt-carry" type="number" step={0.5} min={0} {...form.register("carryForwardMax", { valueAsNumber: true })} />
            </Field>
            <Field label="Notice (days)" htmlFor="lt-notice" error={errors.minNoticeDays?.message} hint="0 allows back-dated requests">
              <Input id="lt-notice" type="number" min={0} {...form.register("minNoticeDays", { valueAsNumber: true })} />
            </Field>
            <Field label="Longest request" htmlFor="lt-max" error={errors.maxConsecutiveDays?.message} hint="Days; blank for no limit">
              <Input id="lt-max" type="number" min={1} {...form.register("maxConsecutiveDays", { setValueAs: idOrNull })} />
            </Field>
            <Field label="Document needed after" htmlFor="lt-attach" error={errors.attachmentAfterDays?.message} hint="Days; blank for never">
              <Input id="lt-attach" type="number" step={0.5} min={0} {...form.register("attachmentAfterDays", { setValueAs: idOrNull })} />
            </Field>
          </div>

          <div className="space-y-3">
            {SWITCHES.map((s) => (
              <SwitchRow key={s.name} control={form.control} {...s} />
            ))}
            {errors.paid && <p className="text-xs text-destructive">{errors.paid.message}</p>}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Who can take it</legend>
            <Controller
              control={form.control}
              name="applicableEmploymentTypes"
              render={({ field }) => (
                <div className="grid grid-cols-2 gap-2.5">
                  {EMPLOYMENT_TYPES.map((t) => {
                    const id = `lt-emp-${t}`;
                    const value = field.value ?? [];
                    return (
                      <div key={t} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={value.includes(t)}
                          onCheckedChange={(checked) => {
                            const next = checked ? [...value, t] : value.filter((v) => v !== t);
                            field.onChange(next.length ? next : null);
                          }}
                        />
                        <Label htmlFor={id}>{EMPLOYMENT_TYPE_LABELS[t]}</Label>
                      </div>
                    );
                  })}
                </div>
              )}
            />
            <p className="text-xs text-muted-foreground">Leave all unticked to offer it to everyone.</p>
          </fieldset>

          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save leave type" : "Create leave type"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function creditSummary(t: LeaveTypeRow): string {
  if (t.isCompOff) return "From comp-off claims";
  if (t.accrual === "none") return t.allowNegative ? "No credit; taken as needed" : "No automatic credit";
  return `${formatDays(t.annualQuota)} ${t.accrual === "monthly" ? "a year, monthly" : "a year, upfront"}`;
}

function rules(t: LeaveTypeRow): string {
  return [
    t.allowHalfDay ? "half days" : "full days only",
    t.minNoticeDays ? `${t.minNoticeDays} day(s) notice` : "no notice",
    t.maxConsecutiveDays ? `max ${formatDays(t.maxConsecutiveDays)}` : null,
    t.attachmentAfterDays !== null ? `document after ${formatDays(t.attachmentAfterDays)}` : null,
    t.countWeekends ? "counts off days" : null,
    t.allowNegative ? "can go negative" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function LeaveTypesClient({ types }: { types: LeaveTypeRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LeaveTypeRow | null>(null);
  const archive = useServerAction(archiveLeaveTypeAction, {
    successMessage: (d) => (d.archived ? "Leave type archived" : "Leave type restored"),
    onSuccess: () => router.refresh(),
  });
  const openSheet = (type: LeaveTypeRow | null) => {
    setEditing(type);
    setOpen(true);
  };

  const columns: ColumnDef<LeaveTypeRow>[] = [
    {
      id: "type",
      header: "Leave type",
      accessorFn: (t) => `${t.code} ${t.name}`,
      cell: ({ row }) => <LeaveTypeTag code={row.original.code} name={row.original.name} color={row.original.color} showName />,
    },
    { id: "credit", header: "Credits", accessorFn: creditSummary },
    { id: "carry", header: "Carry forward", accessorFn: (t) => (t.carryForwardMax ? formatDays(t.carryForwardMax) : "—") },
    { id: "rules", header: "Rules", enableSorting: false, accessorFn: rules, cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue<string>()}</span> },
    { id: "pay", header: "Pay", accessorFn: (t) => (t.isLop ? "Loss of pay" : t.paid ? "Paid" : "Unpaid") },
    {
      id: "status",
      header: "Status",
      accessorFn: (t) => (t.archived ? "Archived" : t.isCompOff ? "System" : "Active"),
      cell: ({ row }) =>
        row.original.archived ? (
          <Badge variant="secondary">Archived</Badge>
        ) : row.original.isCompOff ? (
          <Badge variant="info">System</Badge>
        ) : (
          <Badge variant="success">Active</Badge>
        ),
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
            {!row.original.isCompOff && (
              <DropdownMenuItem onSelect={() => archive.run({ id: row.original.id, archived: !row.original.archived })}>
                {row.original.archived ? <ArchiveRestore /> : <Archive />}
                {row.original.archived ? "Restore" : "Archive"}
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
        data={types}
        searchPlaceholder="Search leave types…"
        toolbar={
          <Button onClick={() => openSheet(null)}>
            <Plus /> New leave type
          </Button>
        }
      />
      <LeaveTypeSheet open={open} onOpenChange={setOpen} editing={editing} />
    </>
  );
}
