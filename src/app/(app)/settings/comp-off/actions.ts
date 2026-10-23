"use server";

import { compOffSettingsFormSchema } from "@/lib/validation/attendance";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { patchSetting } from "@/server/modules/settings/service";

export const updateCompOffSettingsAction = defineAction({
  name: "settings.compoff.update",
  schema: compOffSettingsFormSchema,
  permission: "leave.config",
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = patchSetting(tx, "compOff", input, user.id);
    audit({
      action: "settings.update", entityType: "settings", entityId: "compOff", summary: "Updated comp-off settings",
      diff: diffObjects(before, after),
    });
    return after;
  },
  revalidate: ["/settings/comp-off", "/me/comp-off", "/me/attendance"],
});
