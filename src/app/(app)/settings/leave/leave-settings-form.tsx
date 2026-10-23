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
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { MONTH_NAMES } from "@/lib/dates";
import { leaveSettingsFormSchema } from "@/lib/validation/leave";
import { updateLeaveSettingsAction } from "./actions";

type FormInput = z.input<typeof leaveSettingsFormSchema>;
type FormOutput = z.output<typeof leaveSettingsFormSchema>;

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
        <CardTitle>Leave year</CardTitle>
        <CardDescription>
          Balances, grants and carry-forward follow the leave year. Weekly offs belong to shifts: see{" "}
          <Link href="/time/shifts" className="text-primary hover:underline">
            Shifts
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => run(values))}>
        <CardContent>
          <Field
            label="Leave year starts in"
            htmlFor="yearStartMonth"
            error={errors.yearStartMonth?.message}
            hint={yearLocked ? "Locked: leave has already been granted or taken." : undefined}
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
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={pending || yearLocked}>
            {pending && <Spinner />}
            Save
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
