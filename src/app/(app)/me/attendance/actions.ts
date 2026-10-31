"use server";

import { z } from "zod";
import { dateInTimeZone, formatHm } from "@/lib/dates";
import { regularizationSchema } from "@/lib/validation/attendance";
import { defineAction } from "@/server/actions/define";
import type { DbLike } from "@/server/db/client";
import { requestRegularization, withdrawRegularization } from "@/server/modules/attendance/regularization";
import { getSetting } from "@/server/modules/settings/service";

const PATHS = ["/", "/me/attendance", "/time/attendance", "/time/muster", "/approvals"];
const hasEmployee = (user: { employeeId: number | null }) => user.employeeId !== null;
const timeZone = (db: DbLike) => getSetting(db, "locale").timezone;

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
