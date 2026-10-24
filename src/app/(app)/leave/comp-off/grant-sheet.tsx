"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Gift } from "lucide-react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { SelectOption } from "@/lib/hr";
import { compOffGrantSchema } from "@/lib/validation/attendance";
import { grantCompOffAction } from "./actions";

type FormInput = z.input<typeof compOffGrantSchema>;
type FormOutput = z.output<typeof compOffGrantSchema>;

export function GrantCompOffButton({ employees, today, expiryDays }: { employees: SelectOption[]; today: string; expiryDays: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(compOffGrantSchema),
    defaultValues: { employeeId: undefined, days: 1, earnedOn: today, note: "" },
  });
  const grant = useServerAction(grantCompOffAction, {
    successMessage: (d) => `Granted ${d.days} day(s), usable until ${d.expiresOn}`,
    onSuccess: () => {
      setOpen(false);
      form.reset();
      router.refresh();
    },
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Gift /> Grant comp-off
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Grant comp-off</SheetTitle>
            <SheetDescription>
              For off-day work recorded outside the app. It expires {expiryDays} days after the day worked, like a claimed one.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={form.handleSubmit((values) => grant.run(values))} className="flex flex-1 flex-col gap-4">
            <Field label="Employee" htmlFor="grant-employee" error={errors.employeeId?.message} required>
              <NativeSelect id="grant-employee" defaultValue="" {...form.register("employeeId", { valueAsNumber: true })}>
                <option value="" disabled>
                  Choose…
                </option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Days" htmlFor="grant-days" error={errors.days?.message} required>
                <Input id="grant-days" type="number" step={0.5} min={0.5} max={5} {...form.register("days", { valueAsNumber: true })} />
              </Field>
              <Field label="Day worked" htmlFor="grant-earned" error={errors.earnedOn?.message} required>
                <Input id="grant-earned" type="date" max={today} {...form.register("earnedOn")} />
              </Field>
            </div>
            <Field label="Reason" htmlFor="grant-note" error={errors.note?.message} required>
              <Textarea id="grant-note" rows={3} placeholder="What the work was" {...form.register("note")} />
            </Field>
            <SheetFooter>
              <Button type="submit" disabled={grant.pending}>
                {grant.pending && <Spinner />}
                Grant
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
