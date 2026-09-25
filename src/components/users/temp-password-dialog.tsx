"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function TempPasswordDialog({
  value,
  onClose,
}: {
  value: { email: string; password: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!value} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>
            Share this with {value?.email} privately. It is shown only once and must be changed at first sign-in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border bg-muted px-3 py-2">
          <code data-testid="temp-password" className="flex-1 font-mono text-base tracking-wide">
            {value?.password}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(value?.password ?? "");
              toast.success("Copied to clipboard");
            }}
          >
            <Copy /> Copy
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
