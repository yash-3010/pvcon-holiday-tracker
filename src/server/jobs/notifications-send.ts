import { config } from "@/server/config";
import { deliverNotificationEmails } from "@/server/modules/notifications/email";
import type { JobDefinition } from "./registry";

/** The 10-minute slot of `now` in the company time zone, e.g. `2026-11-10T12:10`. */
function slot(now: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute!.slice(0, 1)}0`;
}

export const notificationsSendJob: JobDefinition = {
  name: "notifications:send",
  description: "Every 10 minutes: emails notifications that weren't sent right after their action.",
  runKey: (now, timeZone) => slot(now, timeZone),
  run: () => "checked",
  deliver: async (db, now) => `${await deliverNotificationEmails(db, { now, appUrl: config.appUrl })} email(s) sent`,
};
