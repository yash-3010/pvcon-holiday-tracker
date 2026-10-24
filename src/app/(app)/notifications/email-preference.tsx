"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EMAIL_MODE_LABELS, EMAIL_MODES, type EmailMode } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { setEmailModeAction } from "./actions";

/** "Email me" choice; saves as soon as an option is picked. */
export function EmailPreference({ initial }: { initial: EmailMode }) {
  const [mode, setMode] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const { run, pending } = useServerAction(setEmailModeAction, {
    successMessage: "Email preference saved",
    onSuccess: (data) => setSaved(data.mode),
    onError: () => setMode(saved),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="size-4" /> Email me
        </CardTitle>
        <CardDescription>How notifications reach your inbox.</CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset disabled={pending} className="grid gap-2 sm:grid-cols-3">
          <legend className="sr-only">Notification email</legend>
          {EMAIL_MODES.map((m) => (
            <label
              key={m}
              className={cn(
                "flex cursor-pointer gap-3 rounded-lg border p-3 text-sm has-focus-visible:ring-2 has-focus-visible:ring-ring",
                mode === m && "border-primary bg-primary/5",
              )}
            >
              <input
                type="radio"
                name="email-mode"
                value={m}
                checked={mode === m}
                onChange={() => {
                  setMode(m);
                  void run({ mode: m });
                }}
                className="mt-0.5 accent-primary"
              />
              <span>
                <span className="block font-medium">{EMAIL_MODE_LABELS[m].label}</span>
                <span className="block text-muted-foreground">{EMAIL_MODE_LABELS[m].description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </CardContent>
    </Card>
  );
}
