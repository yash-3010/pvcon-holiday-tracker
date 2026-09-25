"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import type { z } from "zod";
import { PersonalFields } from "@/components/employees/personal-fields";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { personalSchema } from "@/lib/validation/employees";
import { updateEmployeePersonalAction } from "../actions";

type FormInput = z.input<typeof personalSchema>;
type FormOutput = z.output<typeof personalSchema>;

export function PersonalForm({ employeeId, initial }: { employeeId: number; initial: FormInput }) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(personalSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateEmployeePersonalAction, {
    successMessage: "Personal details saved",
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit((values) => run({ ...values, employeeId }))}>
        <Card>
          <CardContent className="pt-5">
            <PersonalFields part="all" />
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Save personal details
            </Button>
          </CardFooter>
        </Card>
      </form>
    </FormProvider>
  );
}
