"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarPlus, Copy, Download, Ellipsis, FileUp, Pencil, PartyPopper, Plus, Trash2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { dayOfWeek, formatDate } from "@/lib/dates";
import { HOLIDAY_TYPE_LABELS, HOLIDAY_TYPES, WEEKDAY_LABELS } from "@/lib/leave";
import { holidaySchema } from "@/lib/validation/leave";
import type { HolidayRow } from "@/server/db/schema";
import type { HolidayImportResult } from "@/server/modules/holidays/service";
import {
  copyHolidaysAction, createHolidayAction, deleteHolidayAction, importHolidaysAction, setYearConfigAction, updateHolidayAction,
} from "./actions";

type Holiday = HolidayRow & { picks: number };
type FormInput = z.input<typeof holidaySchema>;
type FormOutput = z.output<typeof holidaySchema>;

const TEMPLATE = "date,name,type\n2027-01-26,Republic Day,fixed\n2027-03-22,Holi,optional\n";

function HolidaySheet({
  open, onOpenChange, editing, year,
}: { open: boolean; onOpenChange: (open: boolean) => void; editing: Holiday | null; year: number }) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(holidaySchema),
    values: editing ? { date: editing.date, name: editing.name, type: editing.type } : { date: `${year}-01-01`, name: "", type: "fixed" },
  });
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createHolidayAction, { successMessage: "Holiday added", onSuccess: done, onError });
  const update = useServerAction(updateHolidayAction, { successMessage: "Holiday updated", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  const errors = form.formState.errors;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? "Edit holiday" : "Add holiday"}</SheetTitle>
          <SheetDescription>
            Fixed holidays apply to everyone. Optional ones count as holidays only for employees who pick them.
          </SheetDescription>
        </SheetHeader>
        <form
          onSubmit={form.handleSubmit((values) => (editing ? update.run({ ...values, id: editing.id }) : create.run(values)))}
          className="flex flex-1 flex-col gap-4"
        >
          <Field label="Date" htmlFor="holiday-date" error={errors.date?.message} required>
            <Input id="holiday-date" type="date" {...form.register("date")} />
          </Field>
          <Field label="Name" htmlFor="holiday-name" error={errors.name?.message} required>
            <Input id="holiday-name" {...form.register("name")} />
          </Field>
          <Field
            label="Type"
            htmlFor="holiday-type"
            error={errors.type?.message}
            hint={editing?.type === "optional" && editing.picks ? `Making it fixed clears ${editing.picks} pick(s).` : undefined}
          >
            <NativeSelect id="holiday-type" {...form.register("type")}>
              {HOLIDAY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {HOLIDAY_TYPE_LABELS[t]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save holiday" : "Add holiday"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [csv, setCsv] = useState<string | null>(null);
  const [result, setResult] = useState<HolidayImportResult | null>(null);
  const { run, pending } = useServerAction(importHolidaysAction, {
    onSuccess: (r) => {
      setResult(r);
      if (r.created > 0) {
        toast.success(`Imported ${r.created} holiday(s)`);
        onOpenChange(false);
        router.refresh();
      }
    },
  });
  const download = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "pvcon-holidays-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setCsv(null);
          setResult(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import holidays</DialogTitle>
          <DialogDescription>
            A CSV with the columns date (YYYY-MM-DD), name and type (fixed or optional; blank means fixed). Nothing is saved unless
            every row is valid.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Button variant="outline" size="sm" onClick={download}>
            <Download /> Download template
          </Button>
          <Field label="CSV file" htmlFor="holiday-csv">
            <Input
              id="holiday-csv"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                setResult(null);
                setCsv(file ? await file.text() : null);
              }}
            />
          </Field>
          {result && result.errors.length > 0 && (
            <Alert variant="destructive" title="Nothing was imported">
              <ul className="list-disc space-y-0.5 pl-4">
                {result.errors.map((e) => (
                  <li key={`${e.row}-${e.message}`}>{e.row ? `Row ${e.row}: ${e.message}` : e.message}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button disabled={!csv || pending} onClick={() => csv && run({ csv })}>
            {pending ? <Spinner /> : <FileUp />} Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AllowanceForm({ year, optionalAllowed }: { year: number; optionalAllowed: number }) {
  const router = useRouter();
  const [value, setValue] = useState(String(optionalAllowed));
  const { run, pending } = useServerAction(setYearConfigAction, {
    successMessage: (d) => `Employees can pick ${d.optionalAllowed} optional holiday(s) in ${d.year}`,
    onSuccess: () => router.refresh(),
  });
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run({ year, optionalAllowed: Number(value) });
      }}
    >
      <Field label="Optional holidays each employee may pick" htmlFor="optional-allowed">
        <Input id="optional-allowed" type="number" min={0} max={50} className="w-24" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      <Button type="submit" variant="outline" disabled={pending || value === String(optionalAllowed)}>
        {pending && <Spinner />}
        Save
      </Button>
    </form>
  );
}

export function HolidaysClient({ year, holidays, optionalAllowed }: { year: number; holidays: Holiday[]; optionalAllowed: number }) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState<Holiday | null>(null);
  const remove = useServerAction(deleteHolidayAction, { successMessage: "Holiday removed", onSuccess: () => router.refresh() });
  const copy = useServerAction(copyHolidaysAction, {
    successMessage: (d) => `Copied ${d.created} holiday(s)${d.skipped ? `, skipped ${d.skipped}` : ""}. Check the dates of festivals.`,
    onSuccess: () => router.refresh(),
  });
  const openSheet = (holiday: Holiday | null) => {
    setEditing(holiday);
    setSheetOpen(true);
  };
  const optionalCount = holidays.filter((h) => h.type === "optional").length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {holidays.length - optionalCount} fixed and {optionalCount} optional holiday(s) in {year}
          </CardTitle>
          <CardDescription>Holidays are never counted as leave days and show on everyone&apos;s calendar.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end justify-between gap-4">
          <AllowanceForm key={`${year}-${optionalAllowed}`} year={year} optionalAllowed={optionalAllowed} />
          <div className="flex flex-wrap gap-2">
            <ConfirmDialog
              trigger={
                <Button variant="outline">
                  <Copy /> Copy from {year - 1}
                </Button>
              }
              title={`Copy ${year - 1}'s holidays into ${year}?`}
              description="Each holiday is copied to the same day and month. Dates that already have a holiday are skipped. Festival dates move every year, so check them afterwards."
              confirmLabel="Copy holidays"
              onConfirm={() => copy.run({ fromYear: year - 1, toYear: year })}
            />
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp /> Import CSV
            </Button>
            <Button onClick={() => openSheet(null)}>
              <Plus /> Add holiday
            </Button>
          </div>
        </CardContent>
      </Card>

      {holidays.length === 0 ? (
        <EmptyState
          icon={PartyPopper}
          title={`No holidays for ${year} yet`}
          description="Add them one by one, import a CSV, or copy last year's list."
          action={
            <Button onClick={() => openSheet(null)}>
              <CalendarPlus /> Add holiday
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Date</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Holiday</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Picked by</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(h.date)}</TableCell>
                    <TableCell className="text-muted-foreground">{WEEKDAY_LABELS[dayOfWeek(h.date)]}</TableCell>
                    <TableCell className="font-medium">{h.name}</TableCell>
                    <TableCell>
                      <Badge variant={h.type === "fixed" ? "default" : "info"}>{HOLIDAY_TYPE_LABELS[h.type]}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{h.type === "optional" ? `${h.picks} employee(s)` : "Everyone"}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${h.name}`}>
                            <Ellipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openSheet(h)}>
                            <Pencil /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setDeleting(h)} className="text-destructive">
                            <Trash2 /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <HolidaySheet open={sheetOpen} onOpenChange={setSheetOpen} editing={editing} year={year} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Remove ${deleting?.name ?? "this holiday"}?`}
        description={deleting?.picks ? `${deleting.picks} employee(s) picked it; their picks go too.` : "It stops being a holiday for everyone."}
        confirmLabel="Remove"
        destructive
        onConfirm={() => deleting && remove.run({ id: deleting.id })}
      />
    </div>
  );
}
