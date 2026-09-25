"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil } from "lucide-react";
import { FormProvider, useForm } from "react-hook-form";
import type { z } from "zod";
import { BankFields } from "@/components/employees/bank-fields";
import { bankDetailItems, DetailList } from "@/components/employees/detail-list";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/dates";
import { bankChangeRequestSchema } from "@/lib/validation/employees";
import type { BankView } from "@/server/modules/employees/sensitive";
import { submitBankChangeAction, withdrawBankChangeAction } from "./actions";

type FormInput = z.input<typeof bankChangeRequestSchema>;
type FormOutput = z.output<typeof bankChangeRequestSchema>;
const BLANK: FormInput = { bankName: "", bankAccount: "", bankIfsc: "", pan: "", aadhaar: "", passport: "", reason: "" };

export interface PendingChangeView {
  id: number;
  createdAt: string;
  reason: string | null;
  requested: BankView;
}

export function BankChangeCard({ current, pending, timeZone }: { current: BankView; pending: PendingChangeView | null; timeZone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(bankChangeRequestSchema), defaultValues: BLANK });
  const submit = useServerAction(submitBankChangeAction, {
    successMessage: "Change request sent to HR",
    onSuccess: () => {
      setOpen(false);
      form.reset(BLANK);
      router.refresh();
    },
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const withdraw = useServerAction(withdrawBankChangeAction, { successMessage: "Request withdrawn", onSuccess: () => router.refresh() });
  const requested = pending ? bankDetailItems(pending.requested).map((item) => ({ ...item, value: item.value ?? "Unchanged" })) : [];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">Bank &amp; IDs</CardTitle>
          <CardDescription>Changes need HR approval. Numbers are masked.</CardDescription>
        </div>
        {!pending && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Pencil /> Request a change
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <DetailList items={bankDetailItems(current)} />
        {pending && (
          <Alert variant="info" title="Change request pending">
            <p>
              Sent {formatDateTime(pending.createdAt, timeZone)}
              {pending.reason ? ` · ${pending.reason}` : ""}
            </p>
            <div className="mt-3">
              <DetailList items={requested} />
            </div>
            <div className="mt-3">
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm">
                    Withdraw request
                  </Button>
                }
                title="Withdraw this request?"
                description="HR won't see it any more. You can send a new one afterwards."
                confirmLabel="Withdraw"
                onConfirm={() => withdraw.run({ requestId: pending.id })}
              />
            </div>
          </Alert>
        )}
      </CardContent>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Request a bank or ID change</SheetTitle>
            <SheetDescription>Fill in only what changes. HR checks it before it takes effect.</SheetDescription>
          </SheetHeader>
          <FormProvider {...form}>
            <form onSubmit={form.handleSubmit((values) => submit.run(values))} className="flex flex-1 flex-col gap-4">
              <BankFields keepHint />
              <Field label="Note for HR" htmlFor="reason" error={form.formState.errors.reason?.message}>
                <Textarea id="reason" rows={3} {...form.register("reason")} />
              </Field>
              <SheetFooter>
                <Button type="submit" disabled={submit.pending}>
                  {submit.pending && <Spinner />}
                  Send request
                </Button>
              </SheetFooter>
            </form>
          </FormProvider>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
