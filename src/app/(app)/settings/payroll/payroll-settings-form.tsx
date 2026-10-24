"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { payrollSettingsFormSchema } from "@/lib/validation/settings";
import { updatePayrollSettingsAction } from "./actions";

type Values = z.output<typeof payrollSettingsFormSchema>;

export function PayrollSettingsForm({ initial }: { initial: Values }) {
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(payrollSettingsFormSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updatePayrollSettingsAction, {
    successMessage: "Payroll settings saved",
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;
  const signatory = useWatch({ control: form.control, name: "signatoryEnabled" });
  const attachment = useWatch({ control: form.control, name: "emailAttachment" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payroll</CardTitle>
        <CardDescription>How pay is prorated and what payslips and their emails carry.</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => run(values))}>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Proration basis"
            htmlFor="prorationBasis"
            error={errors.prorationBasis?.message}
            hint="Calendar: every day of the month counts. Working: weekly offs and holidays don't."
            className="sm:col-span-2"
          >
            <NativeSelect id="prorationBasis" {...form.register("prorationBasis")}>
              <option value="calendar">Calendar days</option>
              <option value="working">Working days</option>
            </NativeSelect>
          </Field>
          <Field label="Pay day" htmlFor="payDay" error={errors.payDay?.message} hint="Day of the month salaries are paid.">
            <Input id="payDay" type="number" min={1} max={31} {...form.register("payDay", { valueAsNumber: true })} />
          </Field>
          <Field
            label="Variance flag (%)"
            htmlFor="varianceThresholdPct"
            error={errors.varianceThresholdPct?.message}
            hint="Flag net pay that changed more than this since last month."
          >
            <Input id="varianceThresholdPct" type="number" min={0} max={100} step="0.1" {...form.register("varianceThresholdPct", { valueAsNumber: true })} />
          </Field>
          <Field label="Payslip footer" htmlFor="payslipFooter" error={errors.payslipFooter?.message} className="sm:col-span-2">
            <Textarea id="payslipFooter" rows={2} maxLength={500} placeholder="e.g. Questions? Write to payroll@pvcon.in." {...form.register("payslipFooter")} />
          </Field>
          <Field
            label="Payslip emails"
            htmlFor="emailAttachment"
            error={errors.emailAttachment?.message}
            hint={attachment === "protected" ? "The copy is not signed; the original stays in My payslips." : undefined}
          >
            <NativeSelect id="emailAttachment" {...form.register("emailAttachment")}>
              <option value="none">A link to sign in</option>
              <option value="protected">A link and a password-protected copy</option>
            </NativeSelect>
          </Field>
          <Field label="Copy password" htmlFor="pdfPasswordFormat" error={errors.pdfPasswordFormat?.message} hint="Without a date of birth, the employee code.">
            <NativeSelect id="pdfPasswordFormat" {...form.register("pdfPasswordFormat")}>
              <option value="dob_ddmmyyyy">Date of birth (DDMMYYYY)</option>
              <option value="employee_code">Employee code</option>
            </NativeSelect>
          </Field>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3 sm:col-span-2">
            <div className="space-y-0.5">
              <label htmlFor="signatoryEnabled" className="text-sm font-medium">
                Authorised signatory
              </label>
              <p className="text-xs text-muted-foreground">Print a name and signature instead of the computer-generated line.</p>
            </div>
            <Controller
              control={form.control}
              name="signatoryEnabled"
              render={({ field }) => <Switch id="signatoryEnabled" checked={field.value} onCheckedChange={field.onChange} />}
            />
          </div>
          {signatory && (
            <>
              <Field label="Signatory name" htmlFor="signatoryName" error={errors.signatoryName?.message}>
                <Input id="signatoryName" {...form.register("signatoryName")} />
              </Field>
              <Field label="Designation" htmlFor="signatoryDesignation" error={errors.signatoryDesignation?.message}>
                <Input id="signatoryDesignation" {...form.register("signatoryDesignation")} />
              </Field>
            </>
          )}
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
