"use server";

import { z } from "zod";
import { dateInTimeZone, type ISODate } from "@/lib/dates";
import { formatHours } from "@/lib/timesheets";
import { timerStartSchema, weekSaveSchema } from "@/lib/validation/timesheets";
import { defineAction } from "@/server/actions/define";
import type { DbLike } from "@/server/db/client";
import { saveWeek, submitTimesheet, withdrawTimesheet } from "@/server/modules/timesheets/service";
import { discardTimer, startTimer, stopTimer } from "@/server/modules/timesheets/timer";
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
    return { status: timesheet.status, warnings };
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

export const startTimerAction = defineAction({
  name: "timesheet.timer.start",
  schema: timerStartSchema,
  permission: hasEmployee,
  handler: ({ tx, user, audit }, input) => {
    const timer = startTimer(tx, user, input, { now: new Date() });
    audit({ action: "timesheet.timer", entityType: "employee", entityId: timer.employeeId, summary: "Started the timer" });
    return { startedAt: timer.startedAt };
  },
  revalidate: PATHS,
});

export const stopTimerAction = defineAction({
  name: "timesheet.timer.stop",
  schema: z.object({}),
  permission: hasEmployee,
  handler: ({ tx, user, audit }) => {
    const result = stopTimer(tx, user, { now: new Date() });
    audit({
      action: "timesheet.timer", entityType: "employee", entityId: user.employeeId!,
      summary: result.minutes ? `Stopped the timer: ${formatHours(result.minutes)} h on ${result.date}` : "Stopped the timer: under 8 minutes, nothing added",
    });
    return result;
  },
  revalidate: PATHS,
});

export const discardTimerAction = defineAction({
  name: "timesheet.timer.discard",
  schema: z.object({}),
  permission: hasEmployee,
  handler: ({ tx, user, audit }) => {
    discardTimer(tx, user);
    audit({ action: "timesheet.timer", entityType: "employee", entityId: user.employeeId!, summary: "Discarded the timer" });
    return {};
  },
  revalidate: PATHS,
});
