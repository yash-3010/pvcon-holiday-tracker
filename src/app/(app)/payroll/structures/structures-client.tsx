"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Ellipsis, Pencil, Plus, X } from "lucide-react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
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
import { formatMoney, toMajor, toMinor } from "@/lib/money";
import { calculatePayslip, type CalcComponent } from "@/lib/payroll/calculate";
import { COMPONENT_KIND_LABELS } from "@/lib/payroll/constants";
import { calcSummary } from "@/lib/payroll/preview";
import { structureSchema } from "@/lib/validation/payroll";
import type { SalaryComponentRow, SalaryStructureRow } from "@/server/db/schema";
import { archiveStructureAction, createStructureAction, updateStructureAction } from "./actions";

type FormInput = z.input<typeof structureSchema>;
type FormOutput = z.output<typeof structureSchema>;
type Line = { componentId: number; value: number | null; percent: number | null; formula: string | null };
export type StructureItem = SalaryStructureRow & { components: number; employees: number; lines: Line[] };

const nullableNumber = { setValueAs: (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v)) };

function toCalc(c: SalaryComponentRow, line: FormInput["lines"][number] | undefined): CalcComponent {
  const formula = line?.formula?.trim() ? line.formula : null;
  return {
    code: c.code, name: c.name, kind: c.kind, calc: c.calc,
    value: line?.value != null && !Number.isNaN(line.value) ? toMinor(line.value) : c.defaultValue,
    percentOf: c.percentOf, percent: line?.percent != null && !Number.isNaN(line.percent) ? Math.round(line.percent * 100) : c.percent,
    formula: formula ?? c.formula, prorate: c.prorate, round: c.round, showOnPayslip: c.showOnPayslip, inCtc: c.inCtc,
  };
}

function StructureSheet({
  open, onOpenChange, editing, components,
}: { open: boolean; onOpenChange: (open: boolean) => void; editing: StructureItem | null; components: SalaryComponentRow[] }) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(structureSchema),
    values: editing
      ? {
          name: editing.name, description: editing.description ?? "",
          lines: editing.lines.map((l) => ({
            componentId: l.componentId, value: l.value === null ? null : toMajor(l.value), percent: l.percent === null ? null : l.percent / 100,
            formula: l.formula ?? "",
          })),
        }
      : { name: "", description: "", lines: [] },
  });
  const lines = useFieldArray({ control: form.control, name: "lines" });
  const watched = (useWatch({ control: form.control, name: "lines" }) ?? []) as FormInput["lines"];
  const [adding, setAdding] = useState("");
  const [sampleCtc, setSampleCtc] = useState(1_200_000);
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createStructureAction, { successMessage: "Structure created", onSuccess: done, onError });
  const update = useServerAction(updateStructureAction, { successMessage: "Structure saved", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  const errors = form.formState.errors;
  const byId = new Map(components.map((c) => [c.id, c]));
  const used = new Set(watched.map((l) => l.componentId));
  const available = components.filter((c) => !c.archived && !used.has(c.id));

  const preview = useMemo(() => {
    const calc = watched.flatMap((l) => {
      const c = byId.get(l.componentId);
      return c ? [toCalc(c, l)] : [];
    });
    if (!calc.length) return null;
    return calculatePayslip({
      annualCtc: toMinor(sampleCtc || 0), components: calc, inputs: [],
      variables: { TOTAL_DAYS: 30, PAID_DAYS: 30, WORKING_DAYS: 22, PRESENT_DAYS: 22 },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- byId is derived from components
  }, [watched, components, sampleCtc]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{editing ? `Edit ${editing.name}` : "New structure"}</SheetTitle>
          <SheetDescription>
            Components run in dependency order; the list order is the payslip order. Leave an override blank to use the component&apos;s own.
          </SheetDescription>
        </SheetHeader>
        <form
          // The schema turns rupees into paise and percents into basis points; the action parses the raw values itself.
          onSubmit={form.handleSubmit(() => {
            const raw = form.getValues();
            return editing ? update.run({ ...raw, id: editing.id }) : create.run(raw);
          })}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-1"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="structure-name" error={errors.name?.message} required>
              <Input id="structure-name" {...form.register("name")} />
            </Field>
            <Field label="Description" htmlFor="structure-description" error={errors.description?.message}>
              <Input id="structure-description" {...form.register("description")} />
            </Field>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Components</p>
            {errors.lines?.message && <p className="text-xs text-destructive">{errors.lines.message}</p>}
            {errors.lines?.root?.message && <p className="text-xs text-destructive">{errors.lines.root.message}</p>}
            <div className="divide-y rounded-lg border">
              {lines.fields.map((field, i) => {
                const c = byId.get(watched[i]?.componentId ?? field.componentId);
                if (!c) return null;
                const lineErrors = errors.lines?.[i];
                return (
                  <div key={field.id} className="flex flex-wrap items-center gap-3 p-2">
                    <div className="flex flex-col">
                      <Button type="button" variant="ghost" size="icon" className="size-6" disabled={i === 0} onClick={() => lines.move(i, i - 1)} aria-label={`Move ${c.code} up`}>
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button" variant="ghost" size="icon" className="size-6" disabled={i === lines.fields.length - 1}
                        onClick={() => lines.move(i, i + 1)} aria-label={`Move ${c.code} down`}
                      >
                        <ArrowDown />
                      </Button>
                    </div>
                    <div className="min-w-40 flex-1">
                      <p className="font-mono text-sm font-medium">{c.code}</p>
                      <p className="text-xs text-muted-foreground">
                        {COMPONENT_KIND_LABELS[c.kind]} · {calcSummary({ calc: c.calc, value: c.defaultValue, percent: c.percent, percentOf: c.percentOf, formula: c.formula })}
                      </p>
                    </div>
                    <div className="w-64">
                      {c.calc === "fixed" && (
                        <Input aria-label={`${c.code} amount`} type="number" step="0.01" min={0} placeholder="Amount (₹)" {...form.register(`lines.${i}.value`, nullableNumber)} />
                      )}
                      {c.calc === "percent" && (
                        <Input aria-label={`${c.code} percent`} type="number" step="0.01" min={0} max={100} placeholder={`Percent of ${c.percentOf}`} {...form.register(`lines.${i}.percent`, nullableNumber)} />
                      )}
                      {c.calc === "formula" && (
                        <Input aria-label={`${c.code} formula`} className="font-mono text-xs" placeholder="Formula" {...form.register(`lines.${i}.formula`)} />
                      )}
                      {(lineErrors?.value || lineErrors?.percent || lineErrors?.formula) && (
                        <p className="mt-1 text-xs text-destructive">
                          {lineErrors.value?.message ?? lineErrors.percent?.message ?? lineErrors.formula?.message}
                        </p>
                      )}
                    </div>
                    <Button type="button" variant="ghost" size="icon" onClick={() => lines.remove(i)} aria-label={`Remove ${c.code}`}>
                      <X />
                    </Button>
                  </div>
                );
              })}
              {lines.fields.length === 0 && <p className="p-3 text-sm text-muted-foreground">No components yet.</p>}
            </div>
            <div className="flex gap-2">
              <NativeSelect aria-label="Component to add" value={adding} onChange={(e) => setAdding(e.target.value)} className="max-w-sm">
                <option value="">Add a component…</option>
                {available.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </NativeSelect>
              <Button
                type="button"
                variant="outline"
                disabled={!adding}
                onClick={() => {
                  lines.append({ componentId: Number(adding), value: null, percent: null, formula: "" });
                  setAdding("");
                }}
              >
                <Plus /> Add
              </Button>
            </div>
          </div>

          {preview && (
            <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">A full month at an annual CTC of ₹</span>
                <Input aria-label="Sample annual CTC" type="number" className="h-8 w-32" value={sampleCtc} onChange={(e) => setSampleCtc(Number(e.target.value))} />
              </div>
              {preview.errors.length ? (
                <p className="text-destructive">{preview.errors[0]}</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {preview.lines.map((l) => (
                      <tr key={l.code}>
                        <td className="py-0.5">
                          {l.name} <span className="text-xs text-muted-foreground">{l.explanation}</span>
                        </td>
                        <td className="py-0.5 text-right tabular-nums">
                          {l.kind === "deduction" ? "−" : ""}
                          {formatMoney(l.amount)}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t font-semibold">
                      <td className="pt-1">Net pay</td>
                      <td className="pt-1 text-right tabular-nums">{formatMoney(preview.netPay)}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              {preview.warnings.map((w) => (
                <p key={w} className="text-xs text-warning">
                  {w}
                </p>
              ))}
            </div>
          )}
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save structure" : "Create structure"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function StructuresClient({ structures, components }: { structures: StructureItem[]; components: SalaryComponentRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StructureItem | null>(null);
  const archive = useServerAction(archiveStructureAction, {
    successMessage: (d) => (d.archived ? "Structure archived" : "Structure restored"),
    onSuccess: () => router.refresh(),
  });
  const openSheet = (structure: StructureItem | null) => {
    setEditing(structure);
    setOpen(true);
  };
  const columns: ColumnDef<StructureItem>[] = [
    {
      id: "name",
      header: "Structure",
      accessorFn: (s) => `${s.name} ${s.description ?? ""}`,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          {row.original.description && <p className="text-xs text-muted-foreground">{row.original.description}</p>}
        </div>
      ),
    },
    { accessorKey: "components", header: "Components" },
    { accessorKey: "employees", header: "Employees" },
    {
      id: "status",
      header: "Status",
      accessorFn: (s) => (s.archived ? "Archived" : "Active"),
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
        data={structures}
        searchPlaceholder="Search structures…"
        toolbar={
          <Button onClick={() => openSheet(null)}>
            <Plus /> New structure
          </Button>
        }
      />
      <StructureSheet open={open} onOpenChange={setOpen} editing={editing} components={components} />
    </>
  );
}
