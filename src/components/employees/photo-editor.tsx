"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { Camera, Trash2 } from "lucide-react";
import { removeEmployeePhotoAction, uploadEmployeePhotoAction } from "@/app/(app)/org/employees/actions";
import { useServerAction } from "@/components/forms/use-server-action";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { inlineFileUrl } from "@/lib/files";

/** An employee's photo with Change and Remove buttons; colleagues see it in the directory. */
export function PhotoEditor({ employeeId, name, photoFileId }: { employeeId: number; name: string; photoFileId: number | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const upload = useServerAction(uploadEmployeePhotoAction, { successMessage: "Photo saved", onSuccess: () => router.refresh() });
  const remove = useServerAction(removeEmployeePhotoAction, { successMessage: "Photo removed", onSuccess: () => router.refresh() });
  return (
    <div className="flex items-center gap-4">
      <Avatar name={name} src={photoFileId ? inlineFileUrl(photoFileId) : null} className="size-16 text-lg" />
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Photo file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const form = new FormData();
            form.set("employeeId", String(employeeId));
            form.set("file", file);
            void upload.run(form);
            e.target.value = "";
          }}
        />
        <Button variant="outline" size="sm" disabled={upload.pending} onClick={() => input.current?.click()}>
          <Camera /> {photoFileId ? "Change photo" : "Add photo"}
        </Button>
        {photoFileId && (
          <Button variant="ghost" size="sm" disabled={remove.pending} onClick={() => remove.run({ employeeId })}>
            <Trash2 /> Remove
          </Button>
        )}
      </div>
    </div>
  );
}
