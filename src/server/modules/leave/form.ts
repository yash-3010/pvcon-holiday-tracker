import { z } from "zod";
import { config } from "@/server/config";
import type { DbLike } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { saveUpload } from "@/server/modules/files/service";

/** Reads an apply form: zod-checked fields plus an optional supporting document. */
export async function readLeaveForm<S extends z.ZodType>(form: FormData, schema: S, extra: string[] = []) {
  const raw: Record<string, unknown> = {
    leaveTypeId: Number(form.get("leaveTypeId")),
    startDate: form.get("startDate"),
    endDate: form.get("endDate"),
    startHalf: form.get("startHalf"),
    endHalf: form.get("endHalf"),
    reason: form.get("reason"),
  };
  for (const key of extra) raw[key] = Number(form.get(key));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError("VALIDATION", "Please correct the highlighted fields.", z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  }
  const file = form.get("attachment");
  const attachment = file instanceof File && file.size > 0 ? { name: file.name, data: Buffer.from(await file.arrayBuffer()) } : null;
  return { input: parsed.data as z.output<S>, attachment };
}

export function saveLeaveAttachment(tx: DbLike, attachment: { name: string; data: Buffer } | null, userId: number): number | null {
  if (!attachment) return null;
  return saveUpload(tx, {
    data: attachment.data,
    originalName: attachment.name,
    allowed: ["pdf", "png", "jpeg", "webp"],
    uploadedBy: userId,
    uploadDir: config.uploadDir,
  }).id;
}
