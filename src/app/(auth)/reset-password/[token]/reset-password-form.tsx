"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { resetPasswordAction, type AuthFormState } from "../../actions";

export function ResetPasswordForm({ token, minLength }: { token: string; minLength: number }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(resetPasswordAction, {});
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Set a new password</h1>
        <p className="text-sm text-muted-foreground">
          At least {minLength} characters with upper- and lowercase letters and a number.
        </p>
      </div>
      <input type="hidden" name="token" value={token} />
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
        Save password
      </Button>
      <p className="text-center text-sm">
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
