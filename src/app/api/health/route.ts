import { accessSync, constants, readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export function GET() {
  const checks: Record<string, string> = {};
  let healthy = true;

  try {
    db.get(sql`select 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
    healthy = false;
  }

  try {
    const journalPath = path.join(process.cwd(), "src/server/db/migrations/meta/_journal.json");
    const expected = (JSON.parse(readFileSync(journalPath, "utf8")) as { entries: unknown[] }).entries.length;
    const applied = db.get<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`)?.n ?? 0;
    checks.migrations = applied === expected ? "ok" : `pending (${applied}/${expected})`;
    if (applied !== expected) healthy = false;
  } catch {
    checks.migrations = "unknown";
  }

  try {
    accessSync(path.dirname(path.resolve(config.dbFile)), constants.W_OK);
    checks.storage = "ok";
  } catch {
    checks.storage = "not writable";
    healthy = false;
  }

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checks, time: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
