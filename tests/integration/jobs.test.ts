import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { jobRuns, notifications, passwordResetTokens, users } from "@/server/db/schema";
import { JOBS, findJob, runJobByName } from "@/server/jobs/registry";
import { runJob } from "@/server/jobs/runner";
import { createTestDb } from "../helpers/db";

let db: DB;
beforeEach(() => {
  db = createTestDb();
});

describe("runJob", () => {
  it("runs once per key and skips repeats", () => {
    let calls = 0;
    const first = runJob(db, "demo", "2026-09-24", () => {
      calls++;
      return "done";
    });
    expect(first).toEqual({ status: "succeeded", detail: "done" });
    const second = runJob(db, "demo", "2026-09-24", () => {
      calls++;
    });
    expect(second.status).toBe("skipped");
    expect(calls).toBe(1);
  });

  it("records failures and retries them on the next run", () => {
    const failed = runJob(db, "demo", "k", () => {
      throw new Error("nope");
    });
    expect(failed).toEqual({ status: "failed", detail: "nope" });
    expect(runJob(db, "demo", "k", () => "fixed")).toEqual({ status: "succeeded", detail: "fixed" });
    expect(db.select().from(jobRuns).all()).toHaveLength(1);
  });

  it("reclaims runs stuck in running for over an hour", () => {
    db.insert(jobRuns).values({ job: "demo", runKey: "k", status: "running", startedAt: "2026-09-24T08:00:00.000Z" }).run();
    const now = new Date("2026-09-24T08:30:00.000Z");
    expect(runJob(db, "demo", "k", () => "x", now).status).toBe("skipped");
    const later = new Date("2026-09-24T09:30:00.000Z");
    expect(runJob(db, "demo", "k", () => "x", later).status).toBe("succeeded");
  });
});

describe("registry", () => {
  it("registers the system cleanup job", () => {
    expect(JOBS.map((j) => j.name)).toContain("system:cleanup");
    expect(findJob("missing")).toBeUndefined();
    expect(runJobByName(db, "missing")).toEqual({ status: "failed", detail: "Unknown job: missing" });
  });

  it("cleanup deletes used/expired tokens and old read notifications only", () => {
    const userId = db.insert(users).values({ email: "a@pvcon.in", name: "A", passwordHash: "x" }).returning().get().id;
    const now = new Date("2026-09-24T12:00:00.000Z");
    db.insert(passwordResetTokens).values([
      { userId, tokenHash: "used", expiresAt: "2026-09-25T00:00:00.000Z", usedAt: "2026-09-24T01:00:00.000Z" },
      { userId, tokenHash: "expired", expiresAt: "2026-09-24T11:00:00.000Z" },
      { userId, tokenHash: "valid", expiresAt: "2026-09-24T12:30:00.000Z" },
    ]).run();
    db.insert(notifications).values([
      { userId, type: "t", title: "old read", readAt: "2026-05-01T00:00:00.000Z", createdAt: "2026-05-01T00:00:00.000Z" },
      { userId, type: "t", title: "old unread", createdAt: "2026-05-01T00:00:00.000Z" },
      { userId, type: "t", title: "recent read", readAt: "2026-09-20T00:00:00.000Z", createdAt: "2026-09-20T00:00:00.000Z" },
    ]).run();

    const outcome = runJobByName(db, "system:cleanup", now);
    expect(outcome).toEqual({ status: "succeeded", detail: "Deleted 2 reset tokens and 1 old notifications" });
    expect(db.select().from(passwordResetTokens).all().map((t) => t.tokenHash)).toEqual(["valid"]);
    expect(db.select().from(notifications).all().map((n) => n.title).sort()).toEqual(["old unread", "recent read"]);
    const run = db.select().from(jobRuns).where(eq(jobRuns.job, "system:cleanup")).get()!;
    expect(run.runKey).toBe("2026-09-24");
  });
});
