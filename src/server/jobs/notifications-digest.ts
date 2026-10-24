import { dateInTimeZone } from "@/lib/dates";
import { config } from "@/server/config";
import { deliverDigests } from "@/server/modules/notifications/email";
import type { JobDefinition } from "./registry";

export const notificationsDigestJob: JobDefinition = {
  name: "notifications:digest",
  description: "Daily at 09:00: one email per person who chose a daily digest, listing their new notifications.",
  runKey: (now, timeZone) => dateInTimeZone(now, timeZone),
  run: () => "gathered",
  deliver: async (db, now) => `${await deliverDigests(db, { now, appUrl: config.appUrl })} digest(s) sent`,
};
