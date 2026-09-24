"use server";

import { z } from "zod";
import { defineAction } from "@/server/actions/define";
import { markRead } from "@/server/modules/notifications/service";

/** Marks the given notifications (or all when `ids` is omitted) as read for the current user. */
export const markNotificationsRead = defineAction({
  name: "notifications.mark_read",
  schema: z.object({ ids: z.array(z.number().int().positive()).max(200).optional() }),
  handler: ({ tx, user }, input) => ({ updated: markRead(tx, user.id, input.ids ?? "all") }),
});
