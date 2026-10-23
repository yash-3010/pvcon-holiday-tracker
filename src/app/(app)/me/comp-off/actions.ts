"use server";

import { z } from "zod";
import { dateInTimeZone } from "@/lib/dates";
import { compOffClaimSchema } from "@/lib/validation/attendance";
import { defineAction } from "@/server/actions/define";
import { submitCompOffClaim, withdrawCompOffClaim } from "@/server/modules/compoff/service";
import { getSetting } from "@/server/modules/settings/service";

const PATHS = ["/me/comp-off", "/me/attendance", "/approvals", "/leave/comp-off"];

export const claimCompOffAction = defineAction({
  name: "compoff.claim",
  schema: compOffClaimSchema,
  permission: (user) => user.employeeId !== null,
  handler: ({ tx, user, audit }, input) => {
    const claim = submitCompOffClaim(tx, user, input, { today: dateInTimeZone(new Date(), getSetting(tx, "locale").timezone) });
    audit({
      action: "compoff.claim", entityType: "comp_off_claim", entityId: claim.id,
      summary: `Claimed ${claim.daysRequested} comp-off day(s) for work on ${claim.workedDate}`,
    });
    return { id: claim.id, status: claim.status, daysRequested: claim.daysRequested };
  },
  revalidate: PATHS,
});

export const withdrawCompOffClaimAction = defineAction({
  name: "compoff.withdraw",
  schema: z.object({ claimId: z.number().int().positive() }),
  permission: (user) => user.employeeId !== null,
  handler: ({ tx, user, audit }, { claimId }) => {
    const claim = withdrawCompOffClaim(tx, user, claimId);
    audit({ action: "compoff.withdraw", entityType: "comp_off_claim", entityId: claimId, summary: `Withdrew the comp-off claim for ${claim.workedDate}` });
    return { status: claim.status };
  },
  revalidate: PATHS,
});
