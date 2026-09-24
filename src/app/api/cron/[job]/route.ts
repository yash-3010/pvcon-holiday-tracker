import { NextResponse } from "next/server";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { findJob, runJobByName } from "@/server/jobs/registry";
import { safeEqual } from "@/server/lib/crypto";
import { writeAudit } from "@/server/modules/audit/service";

// Explicit params type: the generated RouteContext helper only exists after `next dev/build`, so a fresh
// `tsc --noEmit` would not know it.
export async function POST(request: Request, ctx: { params: Promise<{ job: string }> }) {
  const secret = config.cronSecret;
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { job } = await ctx.params;
  const name = decodeURIComponent(job);
  if (!findJob(name)) return NextResponse.json({ error: "unknown job" }, { status: 404 });

  const outcome = runJobByName(db, name);
  if (outcome.status !== "skipped") {
    writeAudit(db, { actorUserId: null, action: "job.run", entityType: "job", entityId: name, summary: `Cron: ${outcome.status} — ${outcome.detail}` });
  }
  return NextResponse.json(outcome, { status: outcome.status === "failed" ? 500 : 200 });
}
