"use server";

import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/dates";
import { applyLeaveSchema, cancelLeaveSchema } from "@/lib/validation/leave";
import { defineAction } from "@/server/actions/define";
import type { DbLike } from "@/server/db/client";
import { selectOptionalHoliday } from "@/server/modules/holidays/service";
import { readLeaveForm, saveLeaveAttachment } from "@/server/modules/leave/form";
import { applyLeave, cancelLeave, withdrawLeave } from "@/server/modules/leave/requests";
import { getSetting } from "@/server/modules/settings/service";

const id = z.number().int().positive();
const PATHS = ["/me/leave", "/approvals", "/leave/requests", "/leave/balances", "/team/calendar"];
const today = (db: DbLike) => todayInTimeZone(getSetting(db, "locale").timezone);

export const applyLeaveAction = defineAction({
  name: "leave.apply",
  schema: z.instanceof(FormData),
  permission: (user) => user.employeeId !== null,
  prepare: (form) => readLeaveForm(form, applyLeaveSchema),
  handler: ({ tx, user, audit }, _form, { input, attachment }) => {
    const request = applyLeave(tx, user, input, { today: today(tx), attachmentFileId: saveLeaveAttachment(tx, attachment, user.id) });
    audit({
      action: "leave.apply", entityType: "leave_request", entityId: request.id,
      summary: `Applied for ${request.days} day(s) from ${request.startDate} to ${request.endDate}`,
    });
    return { id: request.id, days: request.days, status: request.status };
  },
  revalidate: PATHS,
});

export const withdrawLeaveAction = defineAction({
  name: "leave.withdraw",
  schema: z.object({ requestId: id }),
  permission: (user) => user.employeeId !== null,
  handler: ({ tx, user, audit }, { requestId }) => {
    const request = withdrawLeave(tx, user, requestId);
    audit({ action: "leave.withdraw", entityType: "leave_request", entityId: requestId, summary: `Withdrew leave from ${request.startDate}` });
    return { status: request.status };
  },
  revalidate: PATHS,
});

/** Employees cancel their own approved leave before it starts; HR (`leave.adjust`) cancels anyone's. */
export const cancelLeaveAction = defineAction({
  name: "leave.cancel",
  schema: cancelLeaveSchema,
  permission: (user) => user.employeeId !== null || can(user, "leave.adjust"),
  handler: ({ tx, user, audit }, { requestId, note }) => {
    const request = cancelLeave(tx, user, requestId, note, { today: today(tx) });
    audit({
      action: "leave.cancel", entityType: "leave_request", entityId: requestId,
      summary: `Cancelled ${request.days} day(s) of leave from ${request.startDate}${note ? `: ${note}` : ""}`,
    });
    return { status: request.status };
  },
  revalidate: PATHS,
});

export const toggleOptionalHolidayAction = defineAction({
  name: "holidays.pick",
  schema: z.object({ holidayId: id, selected: z.boolean() }),
  permission: (user) => user.employeeId !== null,
  handler: ({ tx, user, audit }, { holidayId, selected }) => {
    selectOptionalHoliday(tx, user.employeeId!, holidayId, selected, today(tx));
    audit({
      action: selected ? "holiday.pick" : "holiday.unpick", entityType: "holiday", entityId: holidayId,
      summary: `${selected ? "Picked" : "Unpicked"} an optional holiday`,
    });
    return { selected };
  },
  revalidate: PATHS,
});
