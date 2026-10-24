"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Trash2, Upload } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { removeSignatoryImageAction, uploadSignatoryImageAction } from "./actions";

export function SignatureCard({ fileId }: { fileId: number | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const upload = useServerAction(uploadSignatoryImageAction, { successMessage: "Signature uploaded", onSuccess: () => router.refresh() });
  const remove = useServerAction(removeSignatoryImageAction, { successMessage: "Signature removed", onSuccess: () => router.refresh() });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Signature image</CardTitle>
        <CardDescription>PNG or JPG up to 1 MB, printed above the signatory&apos;s name when the signatory is on.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <div className="flex h-16 w-40 items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {fileId ? (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated dynamic file route
            <img src={`/api/files/${fileId}?inline=1`} alt="Signature" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">No signature</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const form = new FormData();
              form.set("file", file);
              void upload.run(form);
              e.target.value = "";
            }}
          />
          <Button variant="outline" disabled={upload.pending} onClick={() => input.current?.click()}>
            <Upload /> {fileId ? "Replace" : "Upload"}
          </Button>
          {fileId && (
            <Button variant="ghost" disabled={remove.pending} onClick={() => remove.run({})}>
              <Trash2 /> Remove
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
