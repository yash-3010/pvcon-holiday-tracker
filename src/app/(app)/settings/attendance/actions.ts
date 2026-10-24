"use server";

import { attendanceSettingsFormSchema } from "@/lib/validation/attendance";
import { defineAction } from "@/server/actions/define";
import { DomainError } from "@/server/errors";
import { diffObjects } from "@/server/modules/audit/service";
import { recomputeToday } from "@/server/modules/attendance/compute";
import { employeesOnDefaultShift, requireShift } from "@/server/modules/attendance/shifts";
import { getSetting, patchSetting } from "@/server/modules/settings/service";

export const updateAttendanceSettingsAction = defineAction({
  name: "settings.attendance.update",
  schema: attendanceSettingsFormSchema,
  permission: "attendance.manage",
  handler: ({ tx, user, audit }, input) => {
    if (requireShift(tx, input.defaultShiftId).archived) {
      throw new DomainError("ARCHIVED", "Choose an active shift.", { defaultShiftId: ["Archived"] });
    }
    const shiftChanged = getSetting(tx, "attendance").defaultShiftId !== input.defaultShiftId;
    const { before, after } = patchSetting(tx, "attendance", input, user.id);
    if (shiftChanged) recomputeToday(tx, employeesOnDefaultShift(tx));
    audit({
      action: "settings.update", entityType: "settings", entityId: "attendance", summary: "Updated attendance settings",
      diff: diffObjects(before, after),
    });
    return { defaultMode: after.defaultMode, regularizationWindowDays: after.regularizationWindowDays, defaultShiftId: after.defaultShiftId };
  },
  revalidate: ["/settings/attendance", "/time/shifts", "/time/attendance"],
});
