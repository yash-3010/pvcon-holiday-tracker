"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { MONTH_NAMES } from "@/lib/dates";
import { WEEKDAY_LABELS } from "@/lib/leave";
import { leaveSettingsFormSchema } from "@/lib/validation/leave";
import { updateLeaveSettingsAction } from "./actions";

type FormInput = z.input<typeof leaveSettingsFormSchema>;
type FormOutput = z.output<typeof leaveSettingsFormSchema>;

// Monday first, the way people read a week.
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export function LeaveSettingsForm({ initial, yearLocked }: { initial: FormOutput; yearLocked: boolean }) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(leaveSettingsFormSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateLeaveSettingsAction, {
    successMessage: "Leave settings saved",
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Leave year and weekly offs</CardTitle>
        <CardDescription>
          Balances, grants and carry-forward follow the leave year. Weekly offs are never counted as leave unless a leave type
          counts weekends; shifts take this over in a later release.
        </CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => run(values))}>
        <CardContent className="space-y-5">
          <Field
            label="Leave year starts in"
            htmlFor="yearStartMonth"
            error={errors.yearStartMonth?.message}
            hint={yearLocked ? "Locked: leave has already been granted or taken in the current leave year." : undefined}
          >
            {/* A disabled registered input submits undefined, so a locked month stays out of the form and keeps its default. */}
            <NativeSelect
              id="yearStartMonth"
              {...(yearLocked
                ? { disabled: true, value: initial.yearStartMonth, onChange: () => undefined }
                : form.register("yearStartMonth", { valueAsNumber: true }))}
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Weekly offs</legend>
            <Controller
              control={form.control}
              name="weeklyOffs"
              render={({ field }) => (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {WEEK.map((day) => {
                    const id = `weekly-off-${day}`;
                    const value = field.value ?? [];
                    return (
                      <div key={day} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={value.includes(day)}
                          onCheckedChange={(checked) => field.onChange(checked ? [...value, day] : value.filter((d) => d !== day))}
                        />
                        <Label htmlFor={id}>{WEEKDAY_LABELS[day]}</Label>
                      </div>
                    );
                  })}
                </div>
              )}
            />
            {errors.weeklyOffs && <p className="text-xs text-destructive">{errors.weeklyOffs.message}</p>}
          </fieldset>
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
