import { and, eq } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { jobRuns } from "@/server/db/schema";
import { logger } from "@/server/lib/logger";

export type JobOutcome = { status: "succeeded" | "skipped" | "failed"; detail: string };

const STALE_MS = 60 * 60 * 1000;

/** Claims (job, runKey) for a run, or says why it can't run now. */
function claimRun(db: DbLike, job: string, runKey: string, now: Date): { id: number } | JobOutcome {
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
  if (existing) {
    db.update(jobRuns)
      .set({ status: "running", startedAt, finishedAt: null, detail: null })
      .where(eq(jobRuns.id, existing.id))
      .run();
    return { id: existing.id };
  }
  return { id: db.insert(jobRuns).values({ job, runKey, status: "running", startedAt }).returning({ id: jobRuns.id }).get().id };
}

function finishRun(db: DbLike, id: number, outcome: JobOutcome & { status: "succeeded" | "failed" }): JobOutcome {
  db.update(jobRuns).set({ status: outcome.status, finishedAt: new Date().toISOString(), detail: outcome.detail }).where(eq(jobRuns.id, id)).run();
  return outcome;
}

function failed(db: DbLike, id: number, err: unknown, job: string, runKey: string): JobOutcome {
  logger.error({ err, job, runKey }, "job failed");
  return finishRun(db, id, { status: "failed", detail: err instanceof Error ? err.message : String(err) });
}

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
  const claim = claimRun(db, job, runKey, now);
  if (!("id" in claim)) return claim;
  try {
    const detail = db.transaction((tx) => fn(tx)) || "ok";
    return finishRun(db, claim.id, { status: "succeeded", detail });
  } catch (err) {
    return failed(db, claim.id, err, job, runKey);
  }
}

/**
 * Like `runJob`, then awaits `deliver` (email and other async work) outside the transaction. The run succeeds only
 * when both do; a failed delivery is retried with the next call for the same key.
 */
export async function runJobAsync(
  db: DbLike,
  job: string,
  runKey: string,
  fn: (tx: DbLike) => string | void,
  deliver: () => Promise<string>,
  now: Date = new Date(),
): Promise<JobOutcome> {
  const claim = claimRun(db, job, runKey, now);
  if (!("id" in claim)) return claim;
  try {
    const detail = db.transaction((tx) => fn(tx)) || "ok";
    const delivered = await deliver();
    return finishRun(db, claim.id, { status: "succeeded", detail: `${detail}; ${delivered}` });
  } catch (err) {
    return failed(db, claim.id, err, job, runKey);
  }
}
