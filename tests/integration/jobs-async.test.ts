import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { jobRuns } from "@/server/db/schema";
import { findJob, runJobByNameAsync } from "@/server/jobs/registry";
import { runJobAsync } from "@/server/jobs/runner";
import { createTestDb } from "../helpers/db";

let db: DB;
beforeEach(() => {
  db = createTestDb();
});

describe("asynchronous jobs", () => {
  it("run their delivery once per key after the transaction", async () => {
    const order: string[] = [];
    const run = () => {
      order.push("run");
      return "published 1";
    };
    const deliver = async () => {
      order.push("deliver");
      return "sent 2";
    };
    expect(await runJobAsync(db, "demo", "k", run, deliver)).toEqual({ status: "succeeded", detail: "published 1; sent 2" });
    expect((await runJobAsync(db, "demo", "k", run, deliver)).status).toBe("skipped");
    expect(order).toEqual(["run", "deliver"]);
  });

  it("record a failed delivery and retry it", async () => {
    const failed = await runJobAsync(db, "demo", "k", () => "ok", async () => {
      throw new Error("SMTP down");
    });
    expect(failed).toEqual({ status: "failed", detail: "SMTP down" });
    expect(await runJobAsync(db, "demo", "k", () => "ok", async () => "sent")).toEqual({ status: "succeeded", detail: "ok; sent" });
    expect(db.select().from(jobRuns).all()).toHaveLength(1);
  });

  it("include the notification jobs, keyed by ten-minute slot and by day", async () => {
    const send = findJob("notifications:send")!;
    const digest = findJob("notifications:digest")!;
    const now = new Date("2026-11-10T06:47:00Z");
    expect(send.runKey(now, "Asia/Kolkata", db)).toBe("2026-11-10T12:10");
    expect(digest.runKey(now, "Asia/Kolkata", db)).toBe("2026-11-10");
    expect(await runJobByNameAsync(db, "notifications:send", now)).toMatchObject({ status: "succeeded" });
    expect(await runJobByNameAsync(db, "notifications:send", now)).toMatchObject({ status: "skipped" });
  });
});
