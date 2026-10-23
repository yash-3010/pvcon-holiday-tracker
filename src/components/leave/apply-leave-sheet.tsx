"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { dayOfWeek, formatDate, type ISODate } from "@/lib/dates";
import { LEAVE_HALF_LABELS, WEEKDAY_LABELS, countLeaveDays, formatDays, leaveYearOf, type LeaveHalf } from "@/lib/leave";
import type { ActionResult } from "@/server/actions/execute";

export interface ApplyLeaveType {
  id: number;
  code: string;
  name: string;
  allowHalfDay: boolean;
  allowNegative: boolean;
  countWeekends: boolean;
  attachmentAfterDays: number | null;
  minNoticeDays: number;
  maxConsecutiveDays: number | null;
}

export interface ApplyLeaveContext {
  types: ApplyLeaveType[];
  /** Available days per leave year and type id (balance minus pending). */
  available: Record<number, Record<number, number>>;
  weeklyOffs: number[];
  holidays: { date: ISODate; name: string }[];
  today: ISODate;
  leaveYearStartMonth: number;
}

type FormValues = {
  leaveTypeId: number;
  startDate: string;
  endDate: string;
  startHalf: LeaveHalf;
  endHalf: LeaveHalf;
  reason: string;
  employeeId?: number;
};

/**
 * The apply form used on My leave and (with an employee picker) for HR recording leave. The day count is the same
 * pure function the server uses, fed with the employee's weekly offs and holidays.
 */
export function ApplyLeaveSheet<S extends z.ZodType>({
  open,
  onOpenChange,
  context,
  schema,
  action,
  title = "Apply for leave",
  description = "Your manager is notified and can approve or reject it. Weekly offs and holidays are not counted.",
  submitLabel = "Submit request",
  successMessage = "Leave request sent",
  employeePicker,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: ApplyLeaveContext;
  schema: S;
  action: (form: FormData) => Promise<ActionResult<{ id: number; days: number; status: string }>>;
  title?: string;
  description?: string;
  submitLabel?: string;
  successMessage?: string;
  employeePicker?: { options: { value: number; label: string }[] };
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const defaults: FormValues = {
    leaveTypeId: context.types[0]?.id ?? 0, startDate: context.today, endDate: context.today, startHalf: "full", endHalf: "full",
    reason: "", ...(employeePicker ? { employeeId: employeePicker.options[0]?.value ?? 0 } : {}),
  };
  const form = useForm<FormValues>({ resolver: zodResolver(schema as never), defaultValues: defaults });
  const { run, pending } = useServerAction(action, {
    successMessage,
    onSuccess: () => {
      form.reset(defaults);
      setFile(null);
      onOpenChange(false);
      router.refresh();
    },
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });

  const [leaveTypeId, startDate, endDate, startHalf, endHalf] = useWatch({
    control: form.control,
    name: ["leaveTypeId", "startDate", "endDate", "startHalf", "endHalf"],
  });
  const type = context.types.find((t) => t.id === Number(leaveTypeId));
  const single = startDate === endDate;
  const holidayNames = useMemo(() => new Map(context.holidays.map((h) => [h.date, h.name])), [context.holidays]);

  const quote = useMemo(() => {
    if (!type || !startDate || !endDate || endDate < startDate) return null;
    try {
      return countLeaveDays({
        start: startDate, end: endDate, startHalf, endHalf, weeklyOffs: context.weeklyOffs,
        holidays: new Set(holidayNames.keys()), countWeekends: type.countWeekends,
      });
    } catch {
      return null;
    }
  }, [type, startDate, endDate, startHalf, endHalf, context.weeklyOffs, holidayNames]);

  const year = startDate ? leaveYearOf(startDate, context.leaveYearStartMonth) : null;
  const crossesYear = !!startDate && !!endDate && year !== leaveYearOf(endDate, context.leaveYearStartMonth);
  const available = type && year !== null ? context.available[year]?.[type.id] : undefined;
  const needsDocument = !!type && type.attachmentAfterDays !== null && (quote?.days ?? 0) > type.attachmentAfterDays;

  /** Keeps the halves valid when the dates change between one day and several. */
  const normalizeHalves = (start: string, end: string) => {
    if (start === end) form.setValue("endHalf", form.getValues("startHalf"));
    else {
      if (form.getValues("startHalf") === "first_half") form.setValue("startHalf", "full");
      if (form.getValues("endHalf") === "second_half") form.setValue("endHalf", "full");
    }
  };
  const errors = form.formState.errors;

  const submit = form.handleSubmit((values) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null) data.set(key, String(value));
    if (file) data.set("attachment", file);
    return run(data);
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex flex-1 flex-col gap-4">
          {employeePicker && (
            <Field label="Employee" htmlFor="leave-employee" error={errors.employeeId?.message} required>
              <NativeSelect id="leave-employee" {...form.register("employeeId", { valueAsNumber: true })}>
                {employeePicker.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <Field label="Leave type" htmlFor="leave-type" error={errors.leaveTypeId?.message} required>
            <NativeSelect
              id="leave-type"
              {...form.register("leaveTypeId", {
                valueAsNumber: true,
                onChange: (e) => {
                  const next = context.types.find((t) => t.id === Number(e.target.value));
                  if (next && !next.allowHalfDay) {
                    form.setValue("startHalf", "full");
                    form.setValue("endHalf", "full");
                  }
                },
              })}
            >
              {context.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.code})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="leave-start" error={errors.startDate?.message} required>
              <Input
                id="leave-start"
                type="date"
                {...form.register("startDate", {
                  onChange: (e) => {
                    const start = e.target.value as string;
                    if (start && form.getValues("endDate") < start) form.setValue("endDate", start);
                    normalizeHalves(start, form.getValues("endDate"));
                  },
                })}
              />
            </Field>
            <Field label="To" htmlFor="leave-end" error={errors.endDate?.message} required>
              <Input
                id="leave-end"
                type="date"
                min={startDate}
                {...form.register("endDate", { onChange: (e) => normalizeHalves(form.getValues("startDate"), e.target.value) })}
              />
            </Field>
          </div>
          {type?.allowHalfDay &&
            (single ? (
              <Field label="Part of the day" htmlFor="leave-part" error={errors.startHalf?.message}>
                <NativeSelect
                  id="leave-part"
                  {...form.register("startHalf", { onChange: (e) => form.setValue("endHalf", e.target.value) })}
                >
                  {(["full", "first_half", "second_half"] as const).map((h) => (
                    <option key={h} value={h}>
                      {LEAVE_HALF_LABELS[h]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="First day" htmlFor="leave-start-half" error={errors.startHalf?.message}>
                  <NativeSelect id="leave-start-half" {...form.register("startHalf")}>
                    <option value="full">Full day</option>
                    <option value="second_half">From the second half</option>
                  </NativeSelect>
                </Field>
                <Field label="Last day" htmlFor="leave-end-half" error={errors.endHalf?.message}>
                  <NativeSelect id="leave-end-half" {...form.register("endHalf")}>
                    <option value="full">Full day</option>
                    <option value="first_half">Until the first half</option>
                  </NativeSelect>
                </Field>
              </div>
            ))}

          <div className="rounded-lg border bg-muted/40 p-3 text-sm" aria-live="polite" data-testid="leave-day-count">
            {crossesYear ? (
              <p className="text-destructive">This crosses into the next leave year. Split it into two requests.</p>
            ) : quote ? (
              <>
                <p>
                  <span className="text-base font-semibold">{formatDays(quote.days)}</span>
                  {available !== undefined && type && !type.allowNegative && (
                    <span className={available - quote.days < 0 ? "text-destructive" : "text-muted-foreground"}>
                      {" "}
                      · {formatDays(available)} available, {formatDays(available - quote.days)} after this
                    </span>
                  )}
                </p>
                {quote.breakdown.some((d) => d.offReason) && (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {quote.breakdown
                      .filter((d) => d.offReason)
                      .map((d) => (
                        <li key={d.date}>
                          {WEEKDAY_LABELS[dayOfWeek(d.date)].slice(0, 3)} {formatDate(d.date, { day: "2-digit", month: "short" })}:{" "}
                          {d.offReason === "holiday" ? holidayNames.get(d.date) ?? "Holiday" : "Weekly off"}
                          {d.counted ? " (counted)" : " (not counted)"}
                        </li>
                      ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Pick the dates to see how many days this takes.</p>
            )}
          </div>

          <Field label="Reason" htmlFor="leave-reason" error={errors.reason?.message}>
            <Textarea id="leave-reason" rows={3} placeholder="Optional" {...form.register("reason")} />
          </Field>
          <Field
            label="Supporting document"
            htmlFor="leave-attachment"
            error={(errors as Record<string, { message?: string }>).attachment?.message}
            hint={needsDocument ? `Required for ${type?.name} longer than ${formatDays(type!.attachmentAfterDays!)}.` : "PDF or image, optional"}
          >
            <Input id="leave-attachment" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          {needsDocument && !file && <Alert variant="warning" title="Attach a document before submitting" />}

          <SheetFooter>
            <Button type="submit" disabled={pending || crossesYear}>
              {pending && <Spinner />}
              {submitLabel}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
