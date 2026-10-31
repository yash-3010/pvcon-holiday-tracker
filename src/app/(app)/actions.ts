"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { formatHours } from "@/lib/timesheets";
import { startWorkSchema, workSelectionSchema } from "@/lib/validation/clock";
import { defineAction } from "@/server/actions/define";
import type { DbLike } from "@/server/db/client";
import { clientIp } from "@/server/lib/request";
import { clockSnapshot } from "@/server/modules/clock/queries";
import { endWork, resumeWork, startWork, switchTask, takeBreak, type ClockActionResult } from "@/server/modules/clock/service";

// The work clock (refinement 84), used from the top bar on every page, the dashboard and the pop-out.
const PATHS = ["/", "/me/attendance", "/me/timesheets", "/time/attendance", "/time/muster", "/approvals"];
const hasEmployee = (user: { employeeId: number | null }) => user.employeeId !== null;
const ip = async () => clientIp(await headers());

/** The result plus the clock as it now stands, so the browser updates without waiting for a refresh. */
function reply(db: DbLike, employeeId: number, now: Date, result: ClockActionResult) {
  return { ...result, snapshot: clockSnapshot(db, employeeId, now) };
}

const logged = (result: ClockActionResult) => (result.added?.minutes ? `; ${formatHours(result.added.minutes)} h to the timesheet` : "");

export const startWorkAction = defineAction({
  name: "clock.start",
  schema: startWorkSchema,
  permission: hasEmployee,
  prepare: ip,
  handler: ({ tx, user, audit }, input, clientIpAddress) => {
    const now = new Date();
    const result = startWork(tx, user, input, { now, ip: clientIpAddress });
    const snapshot = clockSnapshot(tx, user.employeeId!, now);
    audit({
      action: "attendance.punch", entityType: "attendance_punch", entityId: result.punchId,
      summary: `Clocked in at ${result.time} (${input.workMode})${snapshot.logging ? `, logging to ${snapshot.logging.label}` : ""}`,
    });
    return { ...result, snapshot };
  },
  revalidate: PATHS,
});

export const takeBreakAction = defineAction({
  name: "clock.break",
  schema: z.object({}),
  permission: hasEmployee,
  prepare: ip,
  handler: ({ tx, user, audit }, _input, clientIpAddress) => {
    const now = new Date();
    const result = takeBreak(tx, user, { now, ip: clientIpAddress });
    audit({ action: "attendance.punch", entityType: "attendance_punch", entityId: result.punchId, summary: `Started a break at ${result.time}${logged(result)}` });
    return reply(tx, user.employeeId!, now, result);
  },
  revalidate: PATHS,
});

export const resumeWorkAction = defineAction({
  name: "clock.resume",
  schema: z.object({}),
  permission: hasEmployee,
  prepare: ip,
  handler: ({ tx, user, audit }, _input, clientIpAddress) => {
    const now = new Date();
    const result = resumeWork(tx, user, { now, ip: clientIpAddress });
    audit({ action: "attendance.punch", entityType: "attendance_punch", entityId: result.punchId, summary: `Back from a break at ${result.time}` });
    return reply(tx, user.employeeId!, now, result);
  },
  revalidate: PATHS,
});

export const switchTaskAction = defineAction({
  name: "clock.switch",
  schema: workSelectionSchema,
  permission: hasEmployee,
  handler: ({ tx, user, audit }, selection) => {
    const now = new Date();
    const result = switchTask(tx, user, selection, { now });
    const snapshot = clockSnapshot(tx, user.employeeId!, now);
    audit({
      action: "clock.switch", entityType: "employee", entityId: user.employeeId!,
      summary: `${result.logging ? "Switched to" : "Will log to"} ${snapshot.selection?.label ?? "a task"} at ${result.time}${logged(result)}`,
    });
    return { ...result, snapshot };
  },
  revalidate: PATHS,
});

export const endWorkAction = defineAction({
  name: "clock.end",
  schema: z.object({}),
  permission: hasEmployee,
  prepare: ip,
  handler: ({ tx, user, audit }, _input, clientIpAddress) => {
    const now = new Date();
    const result = endWork(tx, user, { now, ip: clientIpAddress });
    audit({ action: "attendance.punch", entityType: "attendance_punch", entityId: result.punchId, summary: `Clocked out at ${result.time}${logged(result)}` });
    return reply(tx, user.employeeId!, now, result);
  },
  revalidate: PATHS,
});
