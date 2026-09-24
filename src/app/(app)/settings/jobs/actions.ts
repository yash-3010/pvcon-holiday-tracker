"use server";

import { z } from "zod";
import { defineAction } from "@/server/actions/define";
import { DomainError } from "@/server/errors";
import { findJob, runJobByName } from "@/server/jobs/registry";

export const runJobAction = defineAction({
  name: "jobs.run",
  schema: z.object({ name: z.string().min(1).max(100) }),
  permission: "job.run",
  handler: ({ tx, audit }, input) => {
    if (!findJob(input.name)) throw new DomainError("UNKNOWN_JOB", "Unknown job.");
    const outcome = runJobByName(tx, input.name);
    audit({ action: "job.run", entityType: "job", entityId: input.name, summary: `Ran manually: ${outcome.status} — ${outcome.detail}` });
    return outcome;
  },
  revalidate: ["/settings/jobs"],
});
