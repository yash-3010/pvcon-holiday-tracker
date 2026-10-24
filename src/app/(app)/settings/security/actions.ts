"use server";

import { securitySettingsSchema } from "@/lib/validation/settings";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { patchSetting } from "@/server/modules/settings/service";

export const updateSecuritySettings = defineAction({
  name: "settings.security.update",
  schema: securitySettingsSchema,
  permission: "settings.manage",
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = patchSetting(tx, "security", input, user.id);
    audit({ action: "settings.update", entityType: "settings", entityId: "security", summary: "Updated security settings", diff: diffObjects(before, after) });
    return after;
  },
  revalidate: ["/settings/security"],
});
