"use server";

import { z } from "zod";
import { EMAIL_MODE_LABELS } from "@/lib/notifications";
import { emailModeSchema } from "@/lib/validation/notifications";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { markRead, setEmailMode } from "@/server/modules/notifications/service";

/** Marks the given notifications (or all when `ids` is omitted) as read for the current user. */
export const markNotificationsRead = defineAction({
  name: "notifications.mark_read",
  schema: z.object({ ids: z.array(z.number().int().positive()).max(200).optional() }),
  handler: ({ tx, user }, input) => ({ updated: markRead(tx, user.id, input.ids ?? "all") }),
});

/** The caller's own email preference; switching moves their unsent email copies along. */
export const setEmailModeAction = defineAction({
  name: "notifications.email_mode",
  schema: emailModeSchema,
  handler: ({ tx, user, audit }, input) => {
    const change = setEmailMode(tx, user.id, input.mode);
    audit({ action: "user.email_mode", entityType: "user", entityId: user.id, summary: `Set notification email to ${EMAIL_MODE_LABELS[input.mode].label.toLowerCase()}`, diff: diffObjects({ emailMode: change.before }, { emailMode: change.after }) });
    return { mode: change.after };
  },
  revalidate: ["/notifications"],
});
