import type { DbLike } from "@/server/db/client";
import { getSetting } from "@/server/modules/settings/service";
import { runJob, type JobOutcome } from "./runner";
import { systemCleanupJob } from "./system-cleanup";
import { employeeLifecycleJob } from "./employee-lifecycle";
import { leaveAccrueJob } from "./leave-accrue";
import { leaveYearEndJob } from "./leave-year-end";
import { attendanceCloseDayJob } from "./attendance-close-day";
import { compOffExpireJob } from "./compoff-expire";
import { timesheetRemindApproversJob } from "./timesheet-remind-approvers";
import { timesheetRemindEmployeesJob } from "./timesheet-remind-employees";

export interface JobDefinition {
  /** URL-safe name, e.g. `system:cleanup`; also the cron path segment. */
  name: string;
  description: string;
  /** Idempotency key for a given moment, e.g. the local date or `YYYY-MM`. May read settings from `db`. */
  runKey: (now: Date, timeZone: string, db: DbLike) => string;
  /** Synchronous; runs inside a transaction. Returns a human-readable summary. */
  run: (db: DbLike, now: Date, timeZone: string) => string;
}

/** Every scheduled job. Later phases append their jobs here. */
export const JOBS: JobDefinition[] = [
  systemCleanupJob, employeeLifecycleJob, leaveAccrueJob, leaveYearEndJob, attendanceCloseDayJob, compOffExpireJob,
  timesheetRemindEmployeesJob, timesheetRemindApproversJob,
];

export function findJob(name: string): JobDefinition | undefined {
  return JOBS.find((j) => j.name === name);
}

export function runJobByName(db: DbLike, name: string, now: Date = new Date()): JobOutcome {
  const job = findJob(name);
  if (!job) return { status: "failed", detail: `Unknown job: ${name}` };
  const timeZone = getSetting(db, "locale").timezone;
  return runJob(db, job.name, job.runKey(now, timeZone, db), (tx) => job.run(tx, now, timeZone), now);
}
