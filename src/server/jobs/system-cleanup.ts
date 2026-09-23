import { and, isNotNull, lt, or } from "drizzle-orm";
import { dateInTimeZone } from "@/lib/dates";
import { notifications, passwordResetTokens } from "@/server/db/schema";
import type { JobDefinition } from "./registry";

export const systemCleanupJob: JobDefinition = {
  name: "system:cleanup",
  description: "Deletes used or expired password-reset tokens and read notifications older than 90 days.",
  runKey: (now, timeZone) => dateInTimeZone(now, timeZone),
  run: (db, now) => {
    const nowIso = now.toISOString();
    const tokens = db
      .delete(passwordResetTokens)
      .where(or(isNotNull(passwordResetTokens.usedAt), lt(passwordResetTokens.expiresAt, nowIso)))
      .run().changes;
    const cutoff = new Date(now.getTime() - 90 * 86_400_000).toISOString();
    const old = db
      .delete(notifications)
      .where(and(isNotNull(notifications.readAt), lt(notifications.createdAt, cutoff)))
      .run().changes;
    return `Deleted ${tokens} reset tokens and ${old} old notifications`;
  },
};
