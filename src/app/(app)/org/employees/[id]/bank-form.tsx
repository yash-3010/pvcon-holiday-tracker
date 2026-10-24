"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import type { z } from "zod";
import { BankFields } from "@/components/employees/bank-fields";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { bankSchema } from "@/lib/validation/employees";
import { updateEmployeeBankAction } from "../actions";

type FormInput = z.input<typeof bankSchema>;
type FormOutput = z.output<typeof bankSchema>;

export function BankForm({ employeeId, initial }: { employeeId: number; initial: FormInput }) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(bankSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateEmployeeBankAction, {
    successMessage: "Bank details saved",
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit((values) => run({ ...values, employeeId }))}>
        <Card>
          <CardContent className="pt-5">
            <BankFields />
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Save bank details
            </Button>
          </CardFooter>
        </Card>
      </form>
    </FormProvider>
  );
}
