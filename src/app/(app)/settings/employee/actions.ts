"use server";

import { employeeSettingsSchema } from "@/lib/validation/settings";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { nextEmployeeCode } from "@/server/modules/employees/code";
import { patchSetting } from "@/server/modules/settings/service";

export const updateEmployeeSettingsAction = defineAction({
  name: "settings.employee.update",
  schema: employeeSettingsSchema,
  permission: "settings.manage",
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = patchSetting(tx, "employee", input, user.id);
    audit({
      action: "settings.update", entityType: "settings", entityId: "employee",
      summary: "Updated employee code settings", diff: diffObjects(before, after),
    });
    return { nextCode: nextEmployeeCode(tx) };
  },
  revalidate: ["/settings/employee"],
});
