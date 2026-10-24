"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import type { z } from "zod";
import { PersonalFields } from "@/components/employees/personal-fields";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { contactSchema } from "@/lib/validation/employees";
import { updateOwnContactAction } from "./actions";

type FormInput = z.input<typeof contactSchema>;
type FormOutput = z.output<typeof contactSchema>;

export function ContactForm({ initial }: { initial: FormInput }) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(contactSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateOwnContactAction, {
    successMessage: "Contact details saved",
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contact details</CardTitle>
        <CardDescription>You can change these yourself.</CardDescription>
      </CardHeader>
      <FormProvider {...form}>
        <form onSubmit={form.handleSubmit((values) => run(values))}>
          <CardContent>
            <PersonalFields part="contact" />
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Save contact details
            </Button>
          </CardFooter>
        </form>
      </FormProvider>
    </Card>
  );
}
