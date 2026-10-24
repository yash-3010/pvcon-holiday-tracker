"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { changePasswordAction, type AuthFormState } from "../actions";

export function ChangePasswordForm({ forced, minLength }: { forced: boolean; minLength: number }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(changePasswordAction, {});
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Change password</h1>
        <p className="text-sm text-muted-foreground">
          At least {minLength} characters with upper- and lowercase letters and a number.
        </p>
      </div>
      {forced && <Alert variant="warning" title="Password change required">Choose a new password to continue.</Alert>}
      <Field label="Current password" htmlFor="currentPassword" error={state.fieldErrors?.currentPassword?.[0]}>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
      </Field>
      <Field label="New password" htmlFor="newPassword">
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={minLength} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirmPassword" error={state.fieldErrors?.confirmPassword?.[0]}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
      </Field>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Spinner />}
        Update password
      </Button>
      {!forced && (
        <p className="text-center text-sm">
          <Link href="/" className="text-primary hover:underline">
            Cancel
          </Link>
        </p>
      )}
    </form>
  );
}
