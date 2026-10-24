"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Ellipsis, Pencil, Plus, Users } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { WeekdayPicker } from "@/components/attendance/weekday-picker";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { ATTENDANCE_MODES, ATTENDANCE_MODE_LABELS } from "@/lib/attendance";
import { formatMinutes } from "@/lib/dates";
import { WEEKDAY_LABELS } from "@/lib/leave";
import { shiftSchema } from "@/lib/validation/attendance";
import type { ShiftListItem } from "@/server/modules/attendance/shifts";
import { archiveShiftAction, assignShiftAction, createShiftAction, updateShiftAction } from "./actions";

type FormInput = z.input<typeof shiftSchema>;
type FormOutput = z.output<typeof shiftSchema>;
export type AssignableEmployee = { id: number; name: string; code: string; shiftId: number | null };

const NEW_SHIFT: FormInput = {
  name: "", startTime: "09:30", endTime: "18:30", breakMinutes: 60, graceMinutes: 15, halfDayMinutes: 240, fullDayMinutes: 480,
  weeklyOffs: [0, 6], attendanceMode: "punch", autoClockOutTime: "23:30",
};
const offsLabel = (days: number[]) => (days.length ? [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => WEEKDAY_LABELS[d]!.slice(0, 3)).join(", ") : "None");

function ShiftSheet({ open, onOpenChange, editing }: { open: boolean; onOpenChange: (open: boolean) => void; editing: ShiftListItem | null }) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(shiftSchema),
    values: editing
      ? {
          name: editing.name, startTime: editing.startTime, endTime: editing.endTime, breakMinutes: editing.breakMinutes,
          graceMinutes: editing.graceMinutes, halfDayMinutes: editing.halfDayMinutes, fullDayMinutes: editing.fullDayMinutes,
          weeklyOffs: editing.weeklyOffs, attendanceMode: editing.attendanceMode, autoClockOutTime: editing.autoClockOutTime ?? "",
        }
      : NEW_SHIFT,
  });
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createShiftAction, { successMessage: "Shift created", onSuccess: done, onError });
  const update = useServerAction(updateShiftAction, { successMessage: "Shift saved; today is recomputed for its employees", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  const errors = form.formState.errors;
  const number = (name: "breakMinutes" | "graceMinutes" | "halfDayMinutes" | "fullDayMinutes") => form.register(name, { valueAsNumber: true });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editing ? `Edit ${editing.name}` : "New shift"}</SheetTitle>
          <SheetDescription>Times are local wall-clock times. A change applies from today; earlier days keep their result.</SheetDescription>
        </SheetHeader>
        <form
          onSubmit={form.handleSubmit((values) => (editing ? update.run({ ...values, id: editing.id }) : create.run(values)))}
          className="flex flex-1 flex-col gap-4"
        >
          <Field label="Name" htmlFor="shift-name" error={errors.name?.message} required>
            <Input id="shift-name" {...form.register("name")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="shift-start" error={errors.startTime?.message} required>
              <Input id="shift-start" type="time" {...form.register("startTime")} />
            </Field>
            <Field label="Ends" htmlFor="shift-end" error={errors.endTime?.message} required>
              <Input id="shift-end" type="time" {...form.register("endTime")} />
            </Field>
            <Field label="Break (minutes)" htmlFor="shift-break" error={errors.breakMinutes?.message}>
              <Input id="shift-break" type="number" min={0} max={240} {...number("breakMinutes")} />
            </Field>
            <Field label="Grace (minutes)" htmlFor="shift-grace" error={errors.graceMinutes?.message} hint="Late after start + grace.">
              <Input id="shift-grace" type="number" min={0} max={240} {...number("graceMinutes")} />
            </Field>
            <Field label="Half day after (minutes)" htmlFor="shift-half" error={errors.halfDayMinutes?.message}>
              <Input id="shift-half" type="number" min={0} max={1440} {...number("halfDayMinutes")} />
            </Field>
            <Field label="Full day after (minutes)" htmlFor="shift-full" error={errors.fullDayMinutes?.message}>
              <Input id="shift-full" type="number" min={0} max={1440} {...number("fullDayMinutes")} />
            </Field>
          </div>
          <Field label="Attendance" htmlFor="shift-mode" error={errors.attendanceMode?.message}>
            <NativeSelect id="shift-mode" {...form.register("attendanceMode")}>
              {ATTENDANCE_MODES.map((m) => (
                <option key={m} value={m}>
                  {ATTENDANCE_MODE_LABELS[m]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Automatic clock-out"
            htmlFor="shift-auto-out"
            error={errors.autoClockOutTime?.message}
            hint="Closes a session nobody clocked out of. Blank uses the shift end."
          >
            <Input id="shift-auto-out" type="time" {...form.register("autoClockOutTime")} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Weekly offs</legend>
            <Controller
              control={form.control}
              name="weeklyOffs"
              render={({ field }) => <WeekdayPicker idPrefix="shift-off" value={field.value} onChange={field.onChange} />}
            />
            {errors.weeklyOffs?.message && <p className="text-xs text-destructive">{errors.weeklyOffs.message}</p>}
          </fieldset>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save shift" : "Create shift"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function AssignDialog({
  shift, employees, shiftNames, onClose,
}: {
  shift: ShiftListItem | null;
  employees: AssignableEmployee[];
  shiftNames: Map<number, string>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState("");
  const assign = useServerAction(assignShiftAction, {
    successMessage: (d) => `Moved ${d.assigned} employee(s)`,
    onSuccess: () => {
      setSelected([]);
      setQuery("");
      onClose();
      router.refresh();
    },
  });
  if (!shift) return null;
  const onIt = (e: AssignableEmployee) => e.shiftId === shift.id || (e.shiftId === null && shift.isDefault);
  const q = query.trim().toLowerCase();
  const shown = employees.filter((e) => !onIt(e) && (!q || `${e.name} ${e.code}`.toLowerCase().includes(q)));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move employees to {shift.name}</DialogTitle>
          <DialogDescription>From today on they follow this shift&apos;s times and weekly offs.</DialogDescription>
        </DialogHeader>
        <Input placeholder="Search employees…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search employees" />
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
          {shown.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">Everyone already works this shift.</p>
          ) : (
            shown.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/50">
                <Checkbox
                  id={`assign-${e.id}`}
                  checked={selected.includes(e.id)}
                  onCheckedChange={(checked) => setSelected((s) => (checked ? [...s, e.id] : s.filter((x) => x !== e.id)))}
                />
                <Label htmlFor={`assign-${e.id}`} className="flex-1 font-normal">
                  {e.name} <span className="text-xs text-muted-foreground">{e.code}</span>
                </Label>
                <span className="text-xs text-muted-foreground">{e.shiftId === null ? "Default" : shiftNames.get(e.shiftId)}</span>
              </div>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={assign.pending || selected.length === 0} onClick={() => assign.run({ shiftId: shift.id, employeeIds: selected })}>
            {assign.pending && <Spinner />}
            Move {selected.length || ""} employee(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ShiftsClient({ shifts, employees }: { shifts: ShiftListItem[]; employees: AssignableEmployee[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftListItem | null>(null);
  const [assigning, setAssigning] = useState<ShiftListItem | null>(null);
  const archive = useServerAction(archiveShiftAction, {
    successMessage: (d) => (d.archived ? "Shift archived" : "Shift restored"),
    onSuccess: () => router.refresh(),
  });
  const shiftNames = new Map(shifts.map((s) => [s.id, s.name]));
  const openSheet = (shift: ShiftListItem | null) => {
    setEditing(shift);
    setOpen(true);
  };

  const columns: ColumnDef<ShiftListItem>[] = [
    {
      id: "name",
      header: "Shift",
      accessorFn: (s) => s.name,
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium">{row.original.name}</span>
          {row.original.isDefault && <Badge>Default</Badge>}
          {row.original.archived && <Badge variant="secondary">Archived</Badge>}
        </div>
      ),
    },
    {
      id: "times",
      header: "Times",
      accessorFn: (s) => s.startTime,
      cell: ({ row }) => (
        <div className="tabular-nums">
          {row.original.startTime}–{row.original.endTime}
          <p className="text-xs text-muted-foreground">
            {row.original.breakMinutes}m break · {row.original.graceMinutes}m grace
          </p>
        </div>
      ),
    },
    {
      id: "thresholds",
      header: "Half / full day",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatMinutes(row.original.halfDayMinutes)} / {formatMinutes(row.original.fullDayMinutes)}
        </span>
      ),
    },
    { id: "offs", header: "Weekly offs", enableSorting: false, accessorFn: (s) => offsLabel(s.weeklyOffs) },
    { id: "mode", header: "Attendance", accessorFn: (s) => ATTENDANCE_MODE_LABELS[s.attendanceMode] },
    { accessorKey: "employees", header: "Employees" },
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
            {!row.original.archived && (
              <DropdownMenuItem onSelect={() => setAssigning(row.original)}>
                <Users /> Assign employees
              </DropdownMenuItem>
            )}
            {!row.original.isDefault && (
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
        data={shifts}
        searchPlaceholder="Search shifts…"
        toolbar={
          <Button onClick={() => openSheet(null)}>
            <Plus /> New shift
          </Button>
        }
      />
      <ShiftSheet open={open} onOpenChange={setOpen} editing={editing} />
      <AssignDialog shift={assigning} employees={employees} shiftNames={shiftNames} onClose={() => setAssigning(null)} />
    </>
  );
}
