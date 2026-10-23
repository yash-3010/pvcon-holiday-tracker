"use server";

import { count } from "drizzle-orm";
import { leaveSettingsFormSchema } from "@/lib/validation/leave";
import { defineAction } from "@/server/actions/define";
import { leaveLedger } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { diffObjects } from "@/server/modules/audit/service";
import { getSetting, patchSetting } from "@/server/modules/settings/service";

export const updateLeaveSettingsAction = defineAction({
  name: "settings.leave.update",
  schema: leaveSettingsFormSchema,
  permission: "leave.config",
  handler: ({ tx, user, audit }, { yearStartMonth, weeklyOffs }) => {
    const current = getSetting(tx, "leave");
    if (yearStartMonth !== current.yearStartMonth && (tx.select({ n: count() }).from(leaveLedger).get()?.n ?? 0) > 0) {
      throw new DomainError(
        "LEAVE_YEAR_LOCKED",
        "Leave has already been granted or taken, so the leave year can't move any more.",
        { yearStartMonth: ["Locked once leave exists"] },
      );
    }
    const leave = patchSetting(tx, "leave", { yearStartMonth }, user.id);
    const attendance = patchSetting(tx, "attendance", { weeklyOffs }, user.id);
    audit({
      action: "settings.update", entityType: "settings", entityId: "leave", summary: "Updated leave settings",
      diff: diffObjects(
        { yearStartMonth: leave.before.yearStartMonth, weeklyOffs: attendance.before.weeklyOffs },
        { yearStartMonth: leave.after.yearStartMonth, weeklyOffs: attendance.after.weeklyOffs },
      ),
    });
    return { yearStartMonth: leave.after.yearStartMonth };
  },
  revalidate: ["/settings/leave", "/me/leave", "/team/calendar"],
});
