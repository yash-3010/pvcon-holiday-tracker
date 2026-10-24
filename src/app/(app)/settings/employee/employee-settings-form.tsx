"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { employeeSettingsSchema } from "@/lib/validation/settings";
import { updateEmployeeSettingsAction } from "./actions";

type Values = z.infer<typeof employeeSettingsSchema>;

export function EmployeeSettingsForm({ initial, nextCode }: { initial: Values; nextCode: string }) {
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(employeeSettingsSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateEmployeeSettingsAction, {
    successMessage: (d) => `Saved. The next employee gets ${d.nextCode}.`,
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const prefix = form.watch("codePrefix");
  const digits = form.watch("codeDigits");
  const example = `${prefix || "PV"}${"1".padStart(Number.isInteger(digits) ? digits : 4, "0")}`;
  const errors = form.formState.errors;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Employee codes</CardTitle>
        <CardDescription>New employees get the next number after the highest existing code with this prefix.</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => run(values))}>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Prefix" htmlFor="codePrefix" error={errors.codePrefix?.message} hint="1–5 capital letters">
            <Input id="codePrefix" {...form.register("codePrefix", { setValueAs: (v: string) => v.toUpperCase() })} />
          </Field>
          <Field label="Digits" htmlFor="codeDigits" error={errors.codeDigits?.message} hint="3–6">
            <Input id="codeDigits" type="number" min={3} max={6} {...form.register("codeDigits", { valueAsNumber: true })} />
          </Field>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Format: <span className="font-mono">{example}</span> · next code with the saved settings:{" "}
            <span className="font-mono">{nextCode}</span>
          </p>
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
