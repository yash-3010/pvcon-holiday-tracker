"use server";

import { z } from "zod";
import { dateInTimeZone, type ISODate } from "@/lib/dates";
import { formatHours } from "@/lib/timesheets";
import { weekSaveSchema } from "@/lib/validation/timesheets";
import { defineAction } from "@/server/actions/define";
import type { DbLike } from "@/server/db/client";
import { saveWeek, submitTimesheet, withdrawTimesheet } from "@/server/modules/timesheets/service";
import { getSetting } from "@/server/modules/settings/service";

const PATHS = ["/me/timesheets", "/approvals", "/time/projects", "/"];
const hasEmployee = (user: { employeeId: number | null }) => user.employeeId !== null;
const today = (db: DbLike): ISODate => dateInTimeZone(new Date(), getSetting(db, "locale").timezone);
const total = (rows: { minutes: Record<string, number> }[]) => rows.reduce((s, r) => s + Object.values(r.minutes).reduce((a, b) => a + b, 0), 0);

export const saveWeekAction = defineAction({
  name: "timesheet.save",
  schema: weekSaveSchema,
  permission: hasEmployee,
  handler: ({ tx, user, audit }, input) => {
    const { timesheet, warnings } = saveWeek(tx, user, input, { today: today(tx) });
    audit({
      action: "timesheet.save", entityType: "timesheet", entityId: timesheet.id,
      summary: `Saved ${formatHours(total(input.rows))} h for the week of ${input.weekStart}`,
    });
    return { status: timesheet.status, warnings, version: timesheet.updatedAt };
  },
  revalidate: PATHS,
});

/** Saves the grid as it stands, then submits it; both or neither. */
export const submitWeekAction = defineAction({
  name: "timesheet.submit",
  schema: weekSaveSchema,
  permission: hasEmployee,
  handler: ({ tx, user, audit }, input) => {
    const day = today(tx);
    saveWeek(tx, user, input, { today: day });
    const timesheet = submitTimesheet(tx, user, input.weekStart, { today: day, now: new Date() });
    audit({
      action: "timesheet.submit", entityType: "timesheet", entityId: timesheet.id,
      summary: `Submitted ${formatHours(total(input.rows))} h for the week of ${input.weekStart}`,
    });
    return { status: timesheet.status };
  },
  revalidate: PATHS,
});

export const withdrawWeekAction = defineAction({
  name: "timesheet.withdraw",
  schema: z.object({ timesheetId: z.number().int().positive() }),
  permission: hasEmployee,
  handler: ({ tx, user, audit }, { timesheetId }) => {
    const timesheet = withdrawTimesheet(tx, user, timesheetId);
    audit({ action: "timesheet.withdraw", entityType: "timesheet", entityId: timesheetId, summary: `Withdrew the week of ${timesheet.weekStart}` });
    return { status: timesheet.status };
  },
  revalidate: PATHS,
});
