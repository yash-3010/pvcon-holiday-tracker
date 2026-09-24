"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { securitySettingsSchema } from "@/lib/validation/settings";
import { updateSecuritySettings } from "./actions";

type Values = z.infer<typeof securitySettingsSchema>;

export function SecurityForm({ initial }: { initial: Values }) {
  const form = useForm<Values>({ resolver: zodResolver(securitySettingsSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateSecuritySettings, {
    successMessage: "Security settings saved",
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Sign-in protection</CardTitle>
        <CardDescription>Applies to every account. Existing passwords remain valid until changed.</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => run(values))}>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Field label="Failed attempts before lock" htmlFor="lockoutAttempts" error={errors.lockoutAttempts?.message}>
            <Input id="lockoutAttempts" type="number" min={3} max={20} {...form.register("lockoutAttempts", { valueAsNumber: true })} />
          </Field>
          <Field label="Lock duration (minutes)" htmlFor="lockoutMinutes" error={errors.lockoutMinutes?.message}>
            <Input id="lockoutMinutes" type="number" min={1} max={1440} {...form.register("lockoutMinutes", { valueAsNumber: true })} />
          </Field>
          <Field label="Minimum password length" htmlFor="passwordMinLength" error={errors.passwordMinLength?.message}>
            <Input id="passwordMinLength" type="number" min={8} max={64} {...form.register("passwordMinLength", { valueAsNumber: true })} />
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
