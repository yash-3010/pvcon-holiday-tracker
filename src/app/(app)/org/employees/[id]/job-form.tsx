"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";
import { JobFields } from "@/components/employees/job-fields";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { SelectOption } from "@/lib/hr";
import { isoDate, jobSchema } from "@/lib/validation/employees";
import { updateEmployeeJobAction } from "../actions";

const schema = jobSchema.and(z.object({ effectiveDate: isoDate }));
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export function JobForm({
  employeeId,
  initial,
  today,
  departments,
  designations,
  managers,
}: {
  employeeId: number;
  initial: Omit<FormInput, "effectiveDate">;
  today: string;
  departments: SelectOption[];
  designations: SelectOption[];
  managers: SelectOption[];
}) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { ...initial, effectiveDate: today },
  });
  const { run, pending } = useServerAction(updateEmployeeJobAction, {
    successMessage: "Job details saved",
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit((values) => run({ ...values, employeeId }))}>
        <Card>
          <CardContent className="space-y-4 pt-5">
            <JobFields departments={departments} designations={designations} managers={managers} showConfirmation />
            <Field
              label="Changes take effect on"
              htmlFor="effectiveDate"
              error={form.formState.errors.effectiveDate?.message}
              hint="Dates the history entry for department, designation or manager changes"
              className="max-w-xs"
            >
              <Input id="effectiveDate" type="date" {...form.register("effectiveDate")} />
            </Field>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Save job details
            </Button>
          </CardFooter>
        </Card>
      </form>
    </FormProvider>
  );
}
