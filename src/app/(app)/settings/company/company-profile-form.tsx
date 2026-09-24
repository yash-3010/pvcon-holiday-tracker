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
import { Textarea } from "@/components/ui/textarea";
import { companySettingsSchema } from "@/lib/validation/settings";
import { updateCompanyProfile } from "./actions";

const schema = companySettingsSchema.omit({ logoFileId: true });
type Values = z.infer<typeof schema>;

export function CompanyProfileForm({ initial }: { initial: Values }) {
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: initial });
  const { run, pending } = useServerAction(updateCompanyProfile, {
    successMessage: "Company profile saved",
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Company profile</CardTitle>
        <CardDescription>Shown on payslips, letters and emails.</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => run(values))}>
        <CardContent className="space-y-4">
          <Field label="Legal name" htmlFor="legalName" error={errors.legalName?.message} required>
            <Input id="legalName" {...form.register("legalName")} />
          </Field>
          <Field label="Display name" htmlFor="displayName" error={errors.displayName?.message} required>
            <Input id="displayName" {...form.register("displayName")} />
          </Field>
          <Field label="Registered address" htmlFor="address" error={errors.address?.message}>
            <Textarea id="address" rows={3} {...form.register("address")} />
          </Field>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Save profile
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
