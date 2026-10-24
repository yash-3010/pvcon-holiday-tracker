"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { dateInTimeZone, formatHm, minutesInZone } from "@/lib/dates";
import { punchSchema, regularizationSchema } from "@/lib/validation/attendance";
import { defineAction } from "@/server/actions/define";
import type { DbLike } from "@/server/db/client";
import { clientIp } from "@/server/lib/request";
import { clockIn, clockOut } from "@/server/modules/attendance/punches";
import { requestRegularization, withdrawRegularization } from "@/server/modules/attendance/regularization";
import { getSetting } from "@/server/modules/settings/service";

const PATHS = ["/", "/me/attendance", "/time/attendance", "/time/muster", "/approvals"];
const hasEmployee = (user: { employeeId: number | null }) => user.employeeId !== null;
const timeZone = (db: DbLike) => getSetting(db, "locale").timezone;
const ip = async () => clientIp(await headers());

export const clockInAction = defineAction({
  name: "attendance.clock-in",
  schema: punchSchema,
  permission: hasEmployee,
  prepare: ip,
  handler: ({ tx, user, audit }, { workMode }, clientIpAddress) => {
    const now = new Date();
    const punch = clockIn(tx, user.employeeId!, { workMode, ip: clientIpAddress, now });
    const time = formatHm(minutesInZone(now, timeZone(tx)));
    audit({ action: "attendance.punch", entityType: "attendance_punch", entityId: punch.id, summary: `Clocked in at ${time} (${workMode})` });
    return { state: "in" as const, time };
  },
  revalidate: PATHS,
});

export const clockOutAction = defineAction({
  name: "attendance.clock-out",
  schema: z.object({}),
  permission: hasEmployee,
  prepare: ip,
  handler: ({ tx, user, audit }, _input, clientIpAddress) => {
    const now = new Date();
    const punch = clockOut(tx, user.employeeId!, { ip: clientIpAddress, now });
    const time = formatHm(minutesInZone(now, timeZone(tx)));
    audit({ action: "attendance.punch", entityType: "attendance_punch", entityId: punch.id, summary: `Clocked out at ${time}` });
    return { state: "out" as const, time };
  },
  revalidate: PATHS,
});

export const requestRegularizationAction = defineAction({
  name: "regularization.request",
  schema: regularizationSchema,
  permission: hasEmployee,
  handler: ({ tx, user, audit }, input) => {
    const request = requestRegularization(tx, user, input, { today: dateInTimeZone(new Date(), timeZone(tx)) });
    audit({
      action: "regularization.request", entityType: "regularization_request", entityId: request.id,
      summary: `Asked to correct ${request.date} to ${formatHm(request.requestedIn)}–${formatHm(request.requestedOut)}`,
    });
    return { id: request.id, status: request.status };
  },
  revalidate: PATHS,
});

export const withdrawRegularizationAction = defineAction({
  name: "regularization.withdraw",
  schema: z.object({ id: z.number().int().positive() }),
  permission: hasEmployee,
  handler: ({ tx, user, audit }, { id }) => {
    const request = withdrawRegularization(tx, user, id);
    audit({ action: "regularization.withdraw", entityType: "regularization_request", entityId: id, summary: `Withdrew the correction for ${request.date}` });
    return { status: request.status };
  },
  revalidate: PATHS,
});
