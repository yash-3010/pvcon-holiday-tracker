import { and, eq, isNotNull, lt, or } from "drizzle-orm";
import { dateInTimeZone } from "@/lib/dates";
import { jobRuns, notifications, passwordResetTokens } from "@/server/db/schema";
import type { JobDefinition } from "./registry";

export const systemCleanupJob: JobDefinition = {
  name: "system:cleanup",
  description: "Deletes used or expired password-reset tokens, read notifications older than 90 days and week-old runs of the 10-minute email job.",
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
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const runs = db.delete(jobRuns).where(and(eq(jobRuns.job, "notifications:send"), lt(jobRuns.startedAt, weekAgo))).run().changes;
    return `Deleted ${tokens} reset tokens, ${old} old notifications and ${runs} email job runs`;
  },
};
