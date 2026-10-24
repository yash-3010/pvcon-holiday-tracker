"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Ellipsis, Pencil, Plus } from "lucide-react";
import { Controller, useForm, useWatch } from "react-hook-form";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, toMajor, toMinor } from "@/lib/money";
import type { CalcComponent } from "@/lib/payroll/calculate";
import {
  COMPONENT_CALCS, COMPONENT_CALC_LABELS, COMPONENT_KINDS, COMPONENT_KIND_LABELS, ROUND_MODES, ROUND_MODE_LABELS, VARIABLES, VARIABLE_HELP,
} from "@/lib/payroll/constants";
import { validateFormula } from "@/lib/payroll/formula/parser";
import { calcSummary, previewComponent } from "@/lib/payroll/preview";
import { componentSchema } from "@/lib/validation/payroll";
import type { SalaryComponentRow } from "@/server/db/schema";
import { archiveComponentAction, createComponentAction, updateComponentAction } from "./actions";

type FormInput = z.input<typeof componentSchema>;
type FormOutput = z.output<typeof componentSchema>;

const toCalc = (c: SalaryComponentRow): CalcComponent => ({
  code: c.code, name: c.name, kind: c.kind, calc: c.calc, value: c.defaultValue, percentOf: c.percentOf, percent: c.percent, formula: c.formula,
  prorate: c.prorate, round: c.round, showOnPayslip: c.showOnPayslip, inCtc: c.inCtc,
});
const nullableNumber = { setValueAs: (v: unknown) => (v === "" || v === null || v === undefined ? null : Number(v)) };

function emptyValues(): FormInput {
  return {
    code: "", name: "", kind: "earning", calc: "formula", defaultValue: null, percentOf: null, percent: null, formula: "", prorate: true, inCtc: true,
    round: "nearest", showOnPayslip: true, taxableLabel: "",
  };
}

function valuesOf(c: SalaryComponentRow): FormInput {
  return {
    code: c.code, name: c.name, kind: c.kind, calc: c.calc, defaultValue: c.defaultValue === null ? null : toMajor(c.defaultValue),
    percentOf: c.percentOf, percent: c.percent === null ? null : c.percent / 100, formula: c.formula ?? "", prorate: c.prorate, inCtc: c.inCtc,
    round: c.round, showOnPayslip: c.showOnPayslip, taxableLabel: c.taxableLabel ?? "",
  };
}

function ComponentSheet({
  open, onOpenChange, editing, components,
}: { open: boolean; onOpenChange: (open: boolean) => void; editing: SalaryComponentRow | null; components: SalaryComponentRow[] }) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(componentSchema),
    values: editing ? valuesOf(editing) : emptyValues(),
  });
  const [sampleCtc, setSampleCtc] = useState(1_200_000);
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createComponentAction, { successMessage: "Component created", onSuccess: done, onError });
  const update = useServerAction(updateComponentAction, { successMessage: "Component saved", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  const errors = form.formState.errors;
  const values = useWatch({ control: form.control }) as FormInput;
  const others = components.filter((c) => c.id !== editing?.id && !c.archived);

  const known = useMemo(
    () => new Set<string>([...VARIABLES, ...components.flatMap((c) => [c.code, `${c.code}_RATE`]), values.code ?? "", `${values.code ?? ""}_RATE`]),
    [components, values.code],
  );
  const formulaCheck = values.calc === "formula" && values.formula ? validateFormula(values.formula, known) : null;
  const preview = useMemo(() => {
    if (!values.code || !values.calc) return null;
    const target: CalcComponent = {
      code: values.code, name: values.name || values.code, kind: values.kind ?? "earning", calc: values.calc,
      value: values.defaultValue == null || Number.isNaN(values.defaultValue) ? null : toMinor(values.defaultValue),
      percentOf: values.percentOf || null, percent: values.percent == null ? null : Math.round(values.percent * 100),
      formula: values.formula || null, prorate: !!values.prorate, round: values.round ?? "nearest", showOnPayslip: true, inCtc: !!values.inCtc,
    };
    if (target.calc === "input") return null;
    return previewComponent(others.map(toCalc), target, toMinor(sampleCtc || 0));
  }, [values, others, sampleCtc]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{editing ? `Edit ${editing.code}` : "New component"}</SheetTitle>
          <SheetDescription>
            {editing?.system ? "A system component: the run adds its amounts. Only the name and payslip display change." : "Codes are what formulas use, e.g. BASIC or PF."}
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
            <Field label="Code" htmlFor="code" error={errors.code?.message} required hint={editing ? "Codes can't change" : "Capitals, digits and _"}>
              <Input id="code" readOnly={!!editing} className="font-mono uppercase" autoCapitalize="characters" {...form.register("code", { setValueAs: (v: string) => v.toUpperCase() })} />
            </Field>
            <Field label="Name" htmlFor="name" error={errors.name?.message} required>
              <Input id="name" {...form.register("name")} />
            </Field>
            <Field label="Kind" htmlFor="kind" error={errors.kind?.message}>
              <NativeSelect id="kind" {...form.register("kind")}>
                {COMPONENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {COMPONENT_KIND_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Calculation" htmlFor="calc" error={errors.calc?.message}>
              <NativeSelect id="calc" {...form.register("calc")}>
                {COMPONENT_CALCS.map((k) => (
                  <option key={k} value={k}>
                    {COMPONENT_CALC_LABELS[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          {values.calc === "fixed" && (
            <Field label="Monthly amount (₹)" htmlFor="defaultValue" error={errors.defaultValue?.message} required>
              <Input id="defaultValue" type="number" step="0.01" min={0} {...form.register("defaultValue", nullableNumber)} />
            </Field>
          )}
          {values.calc === "percent" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Percent" htmlFor="percent" error={errors.percent?.message} required>
                <Input id="percent" type="number" step="0.01" min={0} max={100} {...form.register("percent", nullableNumber)} />
              </Field>
              <Field label="Of" htmlFor="percentOf" error={errors.percentOf?.message} required>
                <NativeSelect id="percentOf" {...form.register("percentOf", { setValueAs: (v: string) => v || null })}>
                  <option value="">Choose a component</option>
                  {others.map((c) => (
                    <option key={c.id} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          )}
          {values.calc === "formula" && (
            <Field
              label="Formula"
              htmlFor="formula"
              error={errors.formula?.message ?? (formulaCheck && !formulaCheck.ok ? formulaCheck.error : undefined)}
              hint="Rupees. Use component codes (earned), CODE_RATE (full month), the variables below, + − * / %, comparisons, and min, max, round, floor, ceil, abs, if."
            >
              <Textarea id="formula" rows={3} className="font-mono text-sm" spellCheck={false} {...form.register("formula")} />
            </Field>
          )}
          {values.calc === "formula" && (
            <details className="rounded-lg border p-3 text-sm">
              <summary className="cursor-pointer font-medium">Variables</summary>
              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
                {VARIABLES.map((v) => (
                  <div key={v} className="contents">
                    <dt className="font-mono text-xs">{v}</dt>
                    <dd className="text-xs text-muted-foreground">{VARIABLE_HELP[v]}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Rounding" htmlFor="round" error={errors.round?.message}>
              <NativeSelect id="round" {...form.register("round")}>
                {ROUND_MODES.map((m) => (
                  <option key={m} value={m}>
                    {ROUND_MODE_LABELS[m]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Tax label" htmlFor="taxableLabel" error={errors.taxableLabel?.message} hint="Optional, for reports">
              <Input id="taxableLabel" {...form.register("taxableLabel")} />
            </Field>
          </div>
          <div className="space-y-3 rounded-lg border p-3">
            {(
              [
                ["prorate", "Prorate by paid days", "Paid in proportion to PAID_DAYS ÷ TOTAL_DAYS."],
                ["inCtc", "Part of the CTC", "The balance component leaves room for it (earnings and employer contributions)."],
                ["showOnPayslip", "Show on the payslip", "Hidden lines still count in the totals."],
              ] as const
            )
              .filter(([name]) => name !== "inCtc" || ((values.kind === "earning" || values.kind === "employer_contribution") && values.calc !== "input"))
              .map(([name, label, hint]) => (
              <div key={name} className="flex items-center justify-between gap-4">
                <div>
                  <label htmlFor={name} className="text-sm font-medium">
                    {label}
                  </label>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
                <Controller
                  control={form.control}
                  name={name}
                  render={({ field }) => <Switch id={name} checked={!!field.value} onCheckedChange={field.onChange} />}
                />
              </div>
            ))}
          </div>

          {preview && (
            <div className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Preview at an annual CTC of ₹</span>
                <Input
                  aria-label="Sample annual CTC"
                  type="number"
                  className="h-8 w-32"
                  value={sampleCtc}
                  onChange={(e) => setSampleCtc(Number(e.target.value))}
                />
              </div>
              {"error" in preview ? (
                <p className="text-destructive">{preview.error}</p>
              ) : (
                <p>
                  <span className="font-semibold">{formatMoney(preview.amount)}</span> a month{" "}
                  <span className="text-muted-foreground">{preview.explanation}</span>
                </p>
              )}
            </div>
          )}
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save component" : "Create component"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function ComponentsClient({ components }: { components: SalaryComponentRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SalaryComponentRow | null>(null);
  const archive = useServerAction(archiveComponentAction, {
    successMessage: (d) => (d.archived ? "Component archived" : "Component restored"),
    onSuccess: () => router.refresh(),
  });
  const openSheet = (component: SalaryComponentRow | null) => {
    setEditing(component);
    setOpen(true);
  };
  const columns: ColumnDef<SalaryComponentRow>[] = [
    {
      id: "component",
      header: "Component",
      accessorFn: (c) => `${c.code} ${c.name}`,
      cell: ({ row }) => (
        <div>
          <p className="font-mono text-sm font-medium">{row.original.code}</p>
          <p className="text-xs text-muted-foreground">{row.original.name}</p>
        </div>
      ),
    },
    { id: "kind", header: "Kind", accessorFn: (c) => COMPONENT_KIND_LABELS[c.kind] },
    {
      id: "calc",
      header: "Calculation",
      accessorFn: (c) => calcSummary(toCalc(c)),
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue<string>()}</span>,
    },
    {
      id: "flags",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.inCtc && <Badge variant="info">In CTC</Badge>}
          {row.original.prorate && <Badge variant="secondary">Prorated</Badge>}
          {!row.original.showOnPayslip && <Badge variant="outline">Hidden</Badge>}
          {row.original.system && <Badge variant="outline">System</Badge>}
        </div>
      ),
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
            <Button variant="ghost" size="icon" aria-label={`Actions for ${row.original.code}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => openSheet(row.original)}>
              <Pencil /> Edit
            </DropdownMenuItem>
            {!row.original.system && (
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
        data={components}
        searchPlaceholder="Search components…"
        toolbar={
          <Button onClick={() => openSheet(null)}>
            <Plus /> New component
          </Button>
        }
      />
      <ComponentSheet open={open} onOpenChange={setOpen} editing={editing} components={components} />
    </>
  );
}
