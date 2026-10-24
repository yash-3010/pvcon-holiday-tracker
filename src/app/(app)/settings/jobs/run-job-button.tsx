"use client";

import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { toast } from "sonner";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { runJobAction } from "./actions";

export function RunJobButton({ name }: { name: string }) {
  const router = useRouter();
  const { run, pending } = useServerAction(runJobAction, {
    onSuccess: (outcome) => {
      const show = outcome.status === "failed" ? toast.error : toast.success;
      show(`${name}: ${outcome.status}`, { description: outcome.detail });
      router.refresh();
    },
  });
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => run({ name })}>
      {pending ? <Spinner /> : <Play />} Run now
    </Button>
  );
}
