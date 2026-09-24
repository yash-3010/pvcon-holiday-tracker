"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { UserPlus } from "lucide-react";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { createUserSchema } from "@/lib/validation/users";
import { createUserAction } from "./actions";
import { RolePicker } from "./role-picker";

type FormInput = z.input<typeof createUserSchema>;
type FormOutput = z.output<typeof createUserSchema>;

export function AddUserSheet({
  canAssignPrivileged,
  allowedDomain,
  onCreated,
}: {
  canAssignPrivileged: boolean;
  allowedDomain: string;
  onCreated: (result: { email: string; tempPassword: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "", roles: ["employee"] },
  });
  const { run, pending } = useServerAction(createUserAction, {
    onSuccess: (data) => {
      setOpen(false);
      form.reset();
      onCreated(data);
    },
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const errors = form.formState.errors;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button>
          <UserPlus /> Add user
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>New user</SheetTitle>
          <SheetDescription>They get a temporary password and must change it at first sign-in.</SheetDescription>
        </SheetHeader>
        <form onSubmit={form.handleSubmit((values) => run(values))} className="flex flex-1 flex-col gap-4">
          <Field label="Full name" htmlFor="new-name" error={errors.name?.message} required>
            <Input id="new-name" autoComplete="off" {...form.register("name")} />
          </Field>
          <Field label="Work email" htmlFor="new-email" error={errors.email?.message} hint={`Must be an @${allowedDomain} address`} required>
            <Input id="new-email" type="email" autoComplete="off" {...form.register("email")} />
          </Field>
          <Field label="Roles" error={errors.roles?.message}>
            <Controller
              control={form.control}
              name="roles"
              render={({ field }) => (
                <RolePicker value={field.value} onChange={field.onChange} canAssignPrivileged={canAssignPrivileged} idPrefix="new-role" />
              )}
            />
          </Field>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Create user
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
