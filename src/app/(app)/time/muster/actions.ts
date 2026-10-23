"use server";

import { z } from "zod";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/attendance";
import { canAny } from "@/lib/auth/permissions";
import { overrideSchema } from "@/lib/validation/attendance";
import { isoDate } from "@/lib/validation/employees";
import { defineAction } from "@/server/actions/define";
import { DomainError } from "@/server/errors";
import { clearOverride, setOverride } from "@/server/modules/attendance/overrides";
import { attendanceDayDetail, canViewAttendanceOf } from "@/server/modules/attendance/queries";

/** Read-only drill-down behind a muster-roll cell. Nothing changes, so nothing is audited. */
export const attendanceDayAction = defineAction({
  name: "attendance.day",
  schema: z.object({ employeeId: z.number().int().positive(), date: isoDate }),
  permission: (user) => canAny(user, ["attendance.view.all", "regularization.approve"]),
  handler: ({ tx, user }, { employeeId, date }) => {
    if (!canViewAttendanceOf(tx, user, employeeId)) throw new DomainError("FORBIDDEN", "You can only see the attendance of people who report to you.");
    const detail = attendanceDayDetail(tx, employeeId, date);
    if (!detail) throw new DomainError("NOT_FOUND", "Employee not found.");
    return detail;
  },
});

/** An HR decision that wins over the computed status; `status: null` clears it. */
export const setOverrideAction = defineAction({
  name: "attendance.override",
  schema: overrideSchema,
  permission: "attendance.manage",
  handler: ({ tx, user, audit }, { employeeId, date, status, note }) => {
    if (employeeId === user.employeeId) throw new DomainError("SELF_OVERRIDE", "Someone else has to override your own attendance.");
    const row = status === null ? clearOverride(tx, { employeeId, date }) : setOverride(tx, user.id, { employeeId, date, status, note });
    audit({
      action: "attendance.override", entityType: "employee", entityId: employeeId,
      summary: status === null ? `Cleared the attendance override on ${date}` : `Set ${date} to ${ATTENDANCE_STATUS_LABELS[status]}: ${note}`,
    });
    return { status: row.status };
  },
  revalidate: ["/time/muster", "/time/attendance", "/me/attendance"],
});
