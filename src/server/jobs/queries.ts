import { desc } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { jobRuns } from "@/server/db/schema";

export function listRecentJobRuns(db: DbLike, limit = 50) {
  return db.select().from(jobRuns).orderBy(desc(jobRuns.startedAt)).limit(limit).all();
}
