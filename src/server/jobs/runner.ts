import { and, eq } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { jobRuns } from "@/server/db/schema";
import { logger } from "@/server/lib/logger";

export type JobOutcome = { status: "succeeded" | "skipped" | "failed"; detail: string };

const STALE_MS = 60 * 60 * 1000;

/**
 * Runs `fn` at most once successfully per (job, runKey). Failed runs are retried on the next call;
 * runs stuck in `running` for over an hour are reclaimed.
 */
export function runJob(
  db: DbLike,
  job: string,
  runKey: string,
  fn: (tx: DbLike) => string | void,
  now: Date = new Date(),
): JobOutcome {
  const existing = db
    .select()
    .from(jobRuns)
    .where(and(eq(jobRuns.job, job), eq(jobRuns.runKey, runKey)))
    .get();
  if (existing?.status === "succeeded") {
    return { status: "skipped", detail: `Already ran at ${existing.finishedAt}` };
  }
  if (existing?.status === "running" && now.getTime() - Date.parse(existing.startedAt) < STALE_MS) {
    return { status: "skipped", detail: "Already running" };
  }

  const startedAt = now.toISOString();
  let id: number;
  if (existing) {
    db.update(jobRuns)
      .set({ status: "running", startedAt, finishedAt: null, detail: null })
      .where(eq(jobRuns.id, existing.id))
      .run();
    id = existing.id;
  } else {
    id = db
      .insert(jobRuns)
      .values({ job, runKey, status: "running", startedAt })
      .returning({ id: jobRuns.id })
      .get().id;
  }

  try {
    const detail = db.transaction((tx) => fn(tx)) || "ok";
    db.update(jobRuns)
      .set({ status: "succeeded", finishedAt: new Date().toISOString(), detail })
      .where(eq(jobRuns.id, id))
      .run();
    return { status: "succeeded", detail };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    db.update(jobRuns)
      .set({ status: "failed", finishedAt: new Date().toISOString(), detail })
      .where(eq(jobRuns.id, id))
      .run();
    logger.error({ err, job, runKey }, "job failed");
    return { status: "failed", detail };
  }
}
