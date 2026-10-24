"use server";

import { dateInTimeZone } from "@/lib/dates";
import { compOffGrantSchema } from "@/lib/validation/attendance";
import { defineAction } from "@/server/actions/define";
import { DomainError } from "@/server/errors";
import { grantCompOff } from "@/server/modules/compoff/service";
import { getSetting } from "@/server/modules/settings/service";

export const grantCompOffAction = defineAction({
  name: "compoff.grant",
  schema: compOffGrantSchema,
  permission: "leave.adjust",
  handler: ({ tx, user, audit }, input) => {
    if (input.employeeId === user.employeeId) throw new DomainError("SELF_ADJUST", "Someone else has to grant comp-off to you.");
    const lot = grantCompOff(tx, user.id, input, { today: dateInTimeZone(new Date(), getSetting(tx, "locale").timezone) });
    audit({
      action: "compoff.grant", entityType: "employee", entityId: input.employeeId,
      summary: `Granted ${lot.days} comp-off day(s) for ${lot.earnedOn}, expiring ${lot.expiresOn}: ${input.note}`,
    });
    return { id: lot.id, days: lot.days, expiresOn: lot.expiresOn };
  },
  revalidate: ["/leave/comp-off", "/me/comp-off", "/leave/balances", "/me/leave"],
});
