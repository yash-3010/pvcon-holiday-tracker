"use client";

import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { markNotificationsRead } from "./actions";

export function MarkAllButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const { run, pending } = useServerAction(markNotificationsRead, {
    successMessage: "All caught up",
    onSuccess: () => router.refresh(),
  });
  return (
    <Button variant="outline" disabled={disabled || pending} onClick={() => run({})}>
      <CheckCheck /> Mark all read
    </Button>
  );
}
