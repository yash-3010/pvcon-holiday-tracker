"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { idOrNull } from "@/components/forms/select-values";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { compOffSettingsFormSchema } from "@/lib/validation/attendance";
import { updateCompOffSettingsAction } from "./actions";

type Values = z.output<typeof compOffSettingsFormSchema>;

export function CompOffSettingsForm({ initial }: { initial: Values }) {
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(compOffSettingsFormSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateCompOffSettingsAction, {
    successMessage: "Comp-off settings saved",
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Compensatory off</CardTitle>
        <CardDescription>
          Work on a weekly off or holiday earns comp-off once a manager approves the claim. Each grant expires on its own.
        </CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => run(values))}>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-2 sm:col-span-2">
            <Controller
              control={form.control}
              name="enabled"
              render={({ field }) => <Switch id="enabled" checked={field.value} onCheckedChange={field.onChange} />}
            />
            <Label htmlFor="enabled">Employees can claim comp-off</Label>
          </div>
          <Field
            label="Half day after (minutes)"
            htmlFor="halfDayMinutes"
            error={errors.halfDayMinutes?.message}
            hint="Blank uses the employee's shift."
          >
            <Input id="halfDayMinutes" type="number" min={30} max={1440} {...form.register("halfDayMinutes", { setValueAs: idOrNull })} />
          </Field>
          <Field
            label="Full day after (minutes)"
            htmlFor="fullDayMinutes"
            error={errors.fullDayMinutes?.message}
            hint="Blank uses the employee's shift."
          >
            <Input id="fullDayMinutes" type="number" min={30} max={1440} {...form.register("fullDayMinutes", { setValueAs: idOrNull })} />
          </Field>
          <Field
            label="Claim within (days)"
            htmlFor="claimWindowDays"
            error={errors.claimWindowDays?.message}
            hint="Counted from the day worked."
          >
            <Input id="claimWindowDays" type="number" min={1} max={365} {...form.register("claimWindowDays", { valueAsNumber: true })} />
          </Field>
          <Field
            label="Expires after (days)"
            htmlFor="expiryDays"
            error={errors.expiryDays?.message}
            hint="Counted from the day worked."
          >
            <Input id="expiryDays" type="number" min={1} max={730} {...form.register("expiryDays", { valueAsNumber: true })} />
          </Field>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Controller
              control={form.control}
              name="payoutEnabled"
              render={({ field }) => <Switch id="payoutEnabled" checked={field.value} onCheckedChange={field.onChange} />}
            />
            <Label htmlFor="payoutEnabled">Approvers may pay out instead of granting leave (paid through payroll)</Label>
          </div>
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
