"use client";

import { useTransition } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";
import type { ActionResult } from "@/server/actions/execute";

type Failure<T> = Extract<ActionResult<T>, { ok: false }>;

/**
 * Runs a server action inside a transition and toasts the outcome.
 * Errors are toasted unless they only carry field errors and an `onError` handler is provided.
 */
export function useServerAction<I, T>(
  action: (input: I) => Promise<ActionResult<T>>,
  options: {
    successMessage?: string | ((data: T) => string);
    onSuccess?: (data: T) => void;
    onError?: (result: Failure<T>) => void;
  } = {},
) {
  const [pending, startTransition] = useTransition();

  function run(input: I): Promise<ActionResult<T>> {
    return new Promise((resolve) => {
      startTransition(async () => {
        let result: ActionResult<T>;
        try {
          result = await action(input);
        } catch {
          result = { ok: false, code: "NETWORK", error: "Could not reach the server. Please try again." };
        }
        if (result.ok) {
          const message =
            typeof options.successMessage === "function" ? options.successMessage(result.data) : options.successMessage;
          if (message) toast.success(message);
          options.onSuccess?.(result.data);
        } else {
          const onlyFieldErrors = !!result.fieldErrors && Object.keys(result.fieldErrors).length > 0 && !!options.onError;
          if (!onlyFieldErrors) toast.error(result.error);
          options.onError?.(result);
        }
        resolve(result);
      });
    });
  }

  return { run, pending };
}

export function applyFieldErrors<F extends FieldValues>(
  setError: UseFormSetError<F>,
  fieldErrors: Record<string, string[]> | undefined,
): void {
  for (const [field, messages] of Object.entries(fieldErrors ?? {})) {
    if (messages?.length) setError(field as Path<F>, { type: "server", message: messages[0] });
  }
}
