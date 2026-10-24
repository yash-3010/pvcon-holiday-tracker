"use server";

import { z } from "zod";
import { defineAction } from "@/server/actions/define";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { findJob, runJobByNameAsync } from "@/server/jobs/registry";

export const runJobAction = defineAction({
  name: "jobs.run",
  schema: z.object({ name: z.string().min(1).max(100) }),
  permission: "job.run",
  // Jobs keep their own run records and may send email, so they run before the audit transaction.
  prepare: async (input) => {
    if (!findJob(input.name)) throw new DomainError("UNKNOWN_JOB", "Unknown job.");
    return runJobByNameAsync(db, input.name);
  },
  handler: ({ audit }, input, outcome) => {
    audit({ action: "job.run", entityType: "job", entityId: input.name, summary: `Ran manually: ${outcome.status} — ${outcome.detail}` });
    return outcome;
  },
  revalidate: ["/settings/jobs"],
});
