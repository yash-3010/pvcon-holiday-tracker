"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { RequestStatusBadge } from "@/components/attendance/request-status-badge";
import { AttendanceStatusBadge } from "@/components/attendance/status-badge";
import { MonthCalendar } from "@/components/attendance/month-calendar";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { WORK_MODE_LABELS } from "@/lib/attendance";
import { formatDate, formatHm, formatMinutes } from "@/lib/dates";
import { formatDays } from "@/lib/leave";
import { regularizationSchema } from "@/lib/validation/attendance";
import type { MyAttendanceDay } from "@/server/modules/attendance/queries";
import { claimCompOffAction, withdrawCompOffClaimAction } from "../comp-off/actions";
import { requestRegularizationAction, withdrawRegularizationAction } from "./actions";

type RegularizationInput = z.input<typeof regularizationSchema>;
type RegularizationOutput = z.output<typeof regularizationSchema>;

function RegularizeForm({ day, shift, onDone }: { day: MyAttendanceDay; shift: { start: string; end: string }; onDone: () => void }) {
  const form = useForm<RegularizationInput, unknown, RegularizationOutput>({
    resolver: zodResolver(regularizationSchema),
    defaultValues: {
      date: day.date,
      requestedIn: day.firstIn !== null ? formatHm(day.firstIn) : shift.start,
      requestedOut: day.lastOut !== null ? formatHm(day.lastOut) : shift.end,
      reason: "",
    },
  });
  const { run, pending } = useServerAction(requestRegularizationAction, {
    successMessage: "Correction sent for approval",
    onSuccess: onDone,
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;
  // The schema turns HH:MM into minutes; the action parses the raw strings itself.
  return (
    <form onSubmit={form.handleSubmit(() => run(form.getValues()))} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="In" htmlFor="reg-in" error={errors.requestedIn?.message}>
          <Input id="reg-in" type="time" {...form.register("requestedIn")} />
        </Field>
        <Field label="Out" htmlFor="reg-out" error={errors.requestedOut?.message}>
          <Input id="reg-out" type="time" {...form.register("requestedOut")} />
        </Field>
      </div>
      <Field label="What happened" htmlFor="reg-reason" error={errors.reason?.message ?? errors.date?.message}>
        <Textarea id="reg-reason" rows={2} placeholder="Forgot to clock in, client visit…" {...form.register("reason")} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        Request correction
      </Button>
    </form>
  );
}

function CompOffSection({ day, onDone }: { day: MyAttendanceDay; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const claim = useServerAction(claimCompOffAction, { successMessage: "Comp-off claimed; your manager will review it", onSuccess: onDone });
  const withdraw = useServerAction(withdrawCompOffClaimAction, { successMessage: "Claim withdrawn", onSuccess: onDone });
  const compOff = day.compOff!;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Comp-off</h3>
      {compOff.claim && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            Claim <RequestStatusBadge status={compOff.claim.status} />
          </span>
          {compOff.claim.status === "pending" && (
            <Button size="sm" variant="outline" disabled={withdraw.pending} onClick={() => withdraw.run({ claimId: compOff.claim!.id })}>
              Withdraw claim
            </Button>
          )}
        </div>
      )}
      {compOff.canClaim && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Working this day earns {formatDays(compOff.eligibleDays)} of comp-off once your manager approves.
          </p>
          <Field label="Note (optional)" htmlFor="claim-reason">
            <Textarea id="claim-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button disabled={claim.pending} onClick={() => claim.run({ workedDate: day.date, reason: reason || null })}>
            {claim.pending && <Spinner />}
            Claim {formatDays(compOff.eligibleDays)}
          </Button>
        </div>
      )}
    </section>
  );
}

function DayDetail({ day, shift, onDone }: { day: MyAttendanceDay; shift: { start: string; end: string }; onDone: () => void }) {
  const withdraw = useServerAction(withdrawRegularizationAction, { successMessage: "Correction withdrawn", onSuccess: onDone });
  const reg = day.regularization;
  const facts = [
    day.firstIn !== null && ["First in", formatHm(day.firstIn)],
    day.lastOut !== null && ["Last out", formatHm(day.lastOut)],
    ["Worked", formatMinutes(day.workedMinutes)],
    day.lateMinutes > 0 && ["Late by", formatMinutes(day.lateMinutes)],
    day.earlyMinutes > 0 && ["Left early by", formatMinutes(day.earlyMinutes)],
    day.overtimeMinutes > 0 && ["Overtime", formatMinutes(day.overtimeMinutes)],
  ].filter((f): f is [string, string] => !!f);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {day.status ? <AttendanceStatusBadge status={day.status} /> : <Badge variant="outline">{day.isToday ? "Today, in progress" : "Not recorded"}</Badge>}
        {day.holiday && <Badge>{day.holiday}</Badge>}
        {day.leaveCode && <Badge variant="info">{day.leaveCode}</Badge>}
        {day.overridden && <Badge variant="outline">Set by HR</Badge>}
        {day.locked && <Badge variant="outline">Payroll locked</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {day.punches.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-sm font-medium">Punches</h3>
          <ul className="space-y-0.5 text-sm">
            {day.punches.map((p, i) => (
              <li key={i} className="flex items-center gap-2 tabular-nums">
                <span className="w-12">{p.time}</span>
                <span className="w-10 text-muted-foreground">{p.direction === "in" ? "In" : p.startsBreak ? "Break" : "Out"}</span>
                <span className="text-xs text-muted-foreground">
                  {WORK_MODE_LABELS[p.workMode]}
                  {p.source === "auto" ? " · automatic" : p.source === "regularization" ? " · corrected" : p.source === "admin" ? " · by HR" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {reg && (
        <section className="space-y-1">
          <h3 className="text-sm font-medium">Correction</h3>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2 tabular-nums">
              {formatHm(reg.requestedIn)}–{formatHm(reg.requestedOut)} <RequestStatusBadge status={reg.status} />
            </span>
            {reg.status === "pending" && (
              <Button size="sm" variant="outline" disabled={withdraw.pending} onClick={() => withdraw.run({ id: reg.id })}>
                Withdraw
              </Button>
            )}
          </div>
        </section>
      )}
      {day.canRegularize && (
        <>
          <Separator />
          <section className="space-y-2">
            <h3 className="text-sm font-medium">Correct this day</h3>
            <p className="text-xs text-muted-foreground">Your manager approves the times; they replace this day&apos;s punches.</p>
            <RegularizeForm key={day.date} day={day} shift={shift} onDone={onDone} />
          </section>
        </>
      )}
      {day.compOff && (
        <>
          <Separator />
          <CompOffSection key={day.date} day={day} onDone={onDone} />
        </>
      )}
    </div>
  );
}

export function MyAttendanceCalendar({ days, shift }: { days: MyAttendanceDay[]; shift: { start: string; end: string } }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  // Look the day up on every render so a refresh after an action shows the new state.
  const day = days.find((d) => d.date === selected) ?? null;
  return (
    <>
      <MonthCalendar days={days} onSelect={(d) => setSelected(d.date)} />
      <Sheet open={day !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent>
          {day && (
            <>
              <SheetHeader>
                <SheetTitle>{formatDate(day.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</SheetTitle>
                <SheetDescription>What was recorded for this day.</SheetDescription>
              </SheetHeader>
              <DayDetail day={day} shift={shift} onDone={() => router.refresh()} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
