"use server";

import { z } from "zod";
import { companySettingsSchema, localeSettingsSchema } from "@/lib/validation/settings";
import { defineAction } from "@/server/actions/define";
import { config } from "@/server/config";
import { DomainError } from "@/server/errors";
import { diffObjects } from "@/server/modules/audit/service";
import { saveUpload } from "@/server/modules/files/service";
import { patchSetting } from "@/server/modules/settings/service";

export const updateCompanyProfile = defineAction({
  name: "settings.company.update",
  schema: companySettingsSchema.omit({ logoFileId: true }),
  permission: "settings.manage",
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = patchSetting(tx, "company", input, user.id);
    audit({ action: "settings.update", entityType: "settings", entityId: "company", summary: "Updated company profile", diff: diffObjects(before, after) });
    return after;
  },
  revalidate: ["/settings/company"],
});

export const updateLocaleSettings = defineAction({
  name: "settings.locale.update",
  schema: localeSettingsSchema,
  permission: "settings.manage",
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = patchSetting(tx, "locale", input, user.id);
    audit({ action: "settings.update", entityType: "settings", entityId: "locale", summary: "Updated regional settings", diff: diffObjects(before, after) });
    return after;
  },
  revalidate: ["/settings/company"],
});

export const uploadCompanyLogo = defineAction({
  name: "settings.company.logo",
  schema: z.instanceof(FormData),
  permission: "settings.manage",
  prepare: async (form) => {
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("NO_FILE", "Choose an image to upload.");
    return { name: file.name, data: Buffer.from(await file.arrayBuffer()) };
  },
  handler: ({ tx, user, audit }, _input, upload) => {
    const stored = saveUpload(tx, {
      data: upload.data,
      originalName: upload.name,
      allowed: ["png", "jpeg", "webp"],
      uploadedBy: user.id,
      uploadDir: config.uploadDir,
      maxBytes: 2 * 1024 * 1024,
    });
    const { before, after } = patchSetting(tx, "company", { logoFileId: stored.id }, user.id);
    audit({ action: "settings.update", entityType: "settings", entityId: "company", summary: "Uploaded company logo", diff: diffObjects(before, after) });
    return { logoFileId: stored.id };
  },
  revalidate: ["/settings/company"],
});

export const removeCompanyLogo = defineAction({
  name: "settings.company.logo_remove",
  schema: z.object({}),
  permission: "settings.manage",
  handler: ({ tx, user, audit }) => {
    const { before, after } = patchSetting(tx, "company", { logoFileId: null }, user.id);
    audit({ action: "settings.update", entityType: "settings", entityId: "company", summary: "Removed company logo", diff: diffObjects(before, after) });
    return { ok: true };
  },
  revalidate: ["/settings/company"],
});
