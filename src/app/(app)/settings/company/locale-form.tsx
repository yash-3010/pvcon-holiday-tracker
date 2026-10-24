"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { localeSettingsSchema } from "@/lib/validation/settings";
import { updateLocaleSettings } from "./actions";

type Values = z.infer<typeof localeSettingsSchema>;

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function LocaleForm({ initial, timeZones }: { initial: Values; timeZones: string[] }) {
  const form = useForm<Values>({ resolver: zodResolver(localeSettingsSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateLocaleSettings, {
    successMessage: "Regional settings saved",
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Regional settings</CardTitle>
        <CardDescription>Time zone for attendance and dates; currency and fiscal year for payroll.</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => run(values))}>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Time zone" htmlFor="timezone" error={errors.timezone?.message} className="sm:col-span-2">
            <NativeSelect id="timezone" {...form.register("timezone")}>
              {timeZones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Currency" htmlFor="currency" error={errors.currency?.message}>
            <NativeSelect id="currency" {...form.register("currency")}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Fiscal year starts" htmlFor="fiscalYearStartMonth" error={errors.fiscalYearStartMonth?.message}>
            <NativeSelect id="fiscalYearStartMonth" {...form.register("fiscalYearStartMonth", { valueAsNumber: true })}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Save regional settings
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
