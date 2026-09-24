"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Trash2, Upload } from "lucide-react";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { removeCompanyLogo, uploadCompanyLogo } from "./actions";

export function LogoCard({ logoFileId }: { logoFileId: number | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const upload = useServerAction(uploadCompanyLogo, { successMessage: "Logo uploaded", onSuccess: () => router.refresh() });
  const remove = useServerAction(removeCompanyLogo, { successMessage: "Logo removed", onSuccess: () => router.refresh() });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo</CardTitle>
        <CardDescription>PNG, JPG or WebP up to 2 MB. Used on payslips.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-4">
        <div className="flex size-20 items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {logoFileId ? (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated dynamic file route
            <img src={`/api/files/${logoFileId}?inline=1`} alt="Company logo" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">No logo</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
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
            <Upload /> {logoFileId ? "Replace" : "Upload"}
          </Button>
          {logoFileId && (
            <Button variant="ghost" disabled={remove.pending} onClick={() => remove.run({})}>
              <Trash2 /> Remove
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
