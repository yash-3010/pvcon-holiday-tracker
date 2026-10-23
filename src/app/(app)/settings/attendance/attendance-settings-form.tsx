"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { ATTENDANCE_MODES, ATTENDANCE_MODE_LABELS } from "@/lib/attendance";
import { attendanceSettingsFormSchema } from "@/lib/validation/attendance";
import { updateAttendanceSettingsAction } from "./actions";

type Values = z.output<typeof attendanceSettingsFormSchema>;

export function AttendanceSettingsForm({ initial, shifts }: { initial: Values; shifts: { id: number; name: string; times: string }[] }) {
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(attendanceSettingsFormSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateAttendanceSettingsAction, {
    successMessage: "Attendance settings saved",
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Attendance</CardTitle>
        <CardDescription>
          Times, grace, thresholds and weekly offs belong to shifts: see{" "}
          <Link href="/time/shifts" className="text-primary hover:underline">
            Shifts
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => run(values))}>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Default shift"
            htmlFor="defaultShiftId"
            error={errors.defaultShiftId?.message}
            hint="For employees without a shift of their own. A change applies from today."
            className="sm:col-span-2"
          >
            <NativeSelect id="defaultShiftId" {...form.register("defaultShiftId", { valueAsNumber: true })}>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.times})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Mode for new shifts" htmlFor="defaultMode" error={errors.defaultMode?.message}>
            <NativeSelect id="defaultMode" {...form.register("defaultMode")}>
              {ATTENDANCE_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {ATTENDANCE_MODE_LABELS[mode]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Regularization window (days)"
            htmlFor="regularizationWindowDays"
            error={errors.regularizationWindowDays?.message}
            hint="How far back employees can correct a day. 0 turns regularization off."
          >
            <Input
              id="regularizationWindowDays"
              type="number"
              min={0}
              max={365}
              {...form.register("regularizationWindowDays", { valueAsNumber: true })}
            />
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Save
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
