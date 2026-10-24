"use server";

import { z } from "zod";
import { todayInTimeZone } from "@/lib/dates";
import { applyOnBehalfSchema } from "@/lib/validation/leave";
import { defineAction } from "@/server/actions/define";
import { readLeaveForm, saveLeaveAttachment } from "@/server/modules/leave/form";
import { applyLeaveOnBehalf } from "@/server/modules/leave/requests";
import { getSetting } from "@/server/modules/settings/service";

/** HR records leave for an employee: approved at once (spec §5.4, "apply on behalf"). */
export const recordLeaveAction = defineAction({
  name: "leave.record",
  schema: z.instanceof(FormData),
  permission: "leave.adjust",
  prepare: (form) => readLeaveForm(form, applyOnBehalfSchema, ["employeeId"]),
  handler: ({ tx, user, audit }, _form, { input, attachment }) => {
    const today = todayInTimeZone(getSetting(tx, "locale").timezone);
    const request = applyLeaveOnBehalf(tx, user, input, { today, attachmentFileId: saveLeaveAttachment(tx, attachment, user.id) });
    audit({
      action: "leave.record", entityType: "leave_request", entityId: request.id,
      summary: `Recorded ${request.days} day(s) of leave from ${request.startDate} for employee #${request.employeeId}`,
    });
    return { id: request.id, days: request.days, status: request.status };
  },
  revalidate: ["/leave/requests", "/leave/balances", "/team/calendar", "/me/leave"],
});
