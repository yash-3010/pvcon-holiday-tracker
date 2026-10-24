"use client";

import { Send } from "lucide-react";
import { toast } from "sonner";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { sendTestEmailAction } from "./actions";

export function TestEmailButton({ disabled }: { disabled: boolean }) {
  const { run, pending } = useServerAction(sendTestEmailAction, {
    onSuccess: ({ to }) => toast.success("Test email sent", { description: `Check the inbox of ${to}.` }),
  });
  return (
    <Button variant="outline" disabled={disabled || pending} onClick={() => run({})}>
      {pending ? <Spinner /> : <Send />} Send a test email
    </Button>
  );
}
