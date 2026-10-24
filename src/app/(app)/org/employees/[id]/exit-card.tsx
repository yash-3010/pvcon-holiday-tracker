"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { LogOut } from "lucide-react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { DetailList } from "@/components/employees/detail-list";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { addDays, formatDate } from "@/lib/dates";
import type { EmployeeStatus } from "@/lib/hr";
import { resignationSchema } from "@/lib/validation/employees";
import { recordResignationAction, withdrawResignationAction } from "../actions";

type FormInput = z.input<typeof resignationSchema>;
type FormOutput = z.output<typeof resignationSchema>;

export function ExitCard({
  employeeId,
  status,
  resignationDate,
  lastWorkingDate,
  exitReason,
  noticePeriodDays,
  today,
  canExit,
}: {
  employeeId: number;
  status: EmployeeStatus;
  resignationDate: string | null;
  lastWorkingDate: string | null;
  exitReason: string | null;
  noticePeriodDays: number;
  today: string;
  canExit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(resignationSchema),
    defaultValues: { resignationDate: today, lastWorkingDate: addDays(today, noticePeriodDays), exitReason: "" },
  });
  const resign = useServerAction(recordResignationAction, {
    successMessage: "Resignation recorded",
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const withdraw = useServerAction(withdrawResignationAction, { successMessage: "Resignation withdrawn", onSuccess: () => router.refresh() });
  const errors = form.formState.errors;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Exit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {status === "active" ? (
          <>
            <p className="text-muted-foreground">Notice period: {noticePeriodDays} days.</p>
            {canExit && (
              <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                <LogOut /> Record resignation
              </Button>
            )}
          </>
        ) : (
          <DetailList
            columns={1}
            items={[
              { label: "Resigned on", value: resignationDate && formatDate(resignationDate) },
              { label: "Last working day", value: lastWorkingDate && formatDate(lastWorkingDate) },
              { label: "Reason", value: exitReason },
            ]}
          />
        )}
        {status === "on_notice" && canExit && (
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm">
                Withdraw resignation
              </Button>
            }
            title="Withdraw the resignation?"
            description="The employee becomes active again and the open offboarding checklist is cancelled."
            confirmLabel="Withdraw"
            onConfirm={() => withdraw.run({ employeeId })}
          />
        )}
        {status === "exited" && <p className="text-muted-foreground">Their login was disabled the day after their last working day.</p>}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record resignation</DialogTitle>
            <DialogDescription>The employee goes on notice and exits automatically the day after their last working day.</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((values) => resign.run({ ...values, employeeId }))} className="space-y-4">
            <Field label="Resignation date" htmlFor="resignationDate" error={errors.resignationDate?.message}>
              <Input id="resignationDate" type="date" {...form.register("resignationDate")} />
            </Field>
            <Field label="Last working day" htmlFor="lastWorkingDate" error={errors.lastWorkingDate?.message}>
              <Input id="lastWorkingDate" type="date" {...form.register("lastWorkingDate")} />
            </Field>
            <Field label="Reason" htmlFor="exitReason" error={errors.exitReason?.message}>
              <Textarea id="exitReason" rows={3} {...form.register("exitReason")} />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={resign.pending}>
                {resign.pending && <Spinner />}
                Record resignation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
