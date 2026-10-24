"use server";

import { z } from "zod";
import { payrollSettingsFormSchema } from "@/lib/validation/settings";
import { defineAction } from "@/server/actions/define";
import { config } from "@/server/config";
import { DomainError } from "@/server/errors";
import { diffObjects } from "@/server/modules/audit/service";
import { saveUpload } from "@/server/modules/files/service";
import { patchSetting } from "@/server/modules/settings/service";

export const updatePayrollSettingsAction = defineAction({
  name: "settings.payroll.update",
  schema: payrollSettingsFormSchema,
  permission: "payroll.configure",
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = patchSetting(tx, "payroll", input, user.id);
    audit({ action: "settings.update", entityType: "settings", entityId: "payroll", summary: "Updated payroll settings", diff: diffObjects(before, after) });
    return { ok: true };
  },
  revalidate: ["/settings/payroll"],
});

export const uploadSignatoryImageAction = defineAction({
  name: "settings.payroll.signature",
  schema: z.instanceof(FormData),
  permission: "payroll.configure",
  prepare: async (form) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("NO_FILE", "Choose an image to upload.");
    return { name: file.name, data: Buffer.from(await file.arrayBuffer()) };
  },
  handler: ({ tx, user, audit }, _input, upload) => {
    const stored = saveUpload(tx, {
      data: upload.data, originalName: upload.name, allowed: ["png", "jpeg"], uploadedBy: user.id, uploadDir: config.uploadDir,
      maxBytes: 1024 * 1024,
    });
    const { before, after } = patchSetting(tx, "payroll", { signatoryImageFileId: stored.id }, user.id);
    audit({ action: "settings.update", entityType: "settings", entityId: "payroll", summary: "Uploaded the signatory's signature", diff: diffObjects(before, after) });
    return { fileId: stored.id };
  },
  revalidate: ["/settings/payroll"],
});

export const removeSignatoryImageAction = defineAction({
  name: "settings.payroll.signature_remove",
  schema: z.object({}),
  permission: "payroll.configure",
  handler: ({ tx, user, audit }) => {
    const { before, after } = patchSetting(tx, "payroll", { signatoryImageFileId: null }, user.id);
    audit({ action: "settings.update", entityType: "settings", entityId: "payroll", summary: "Removed the signatory's signature", diff: diffObjects(before, after) });
    return { ok: true };
  },
  revalidate: ["/settings/payroll"],
});
