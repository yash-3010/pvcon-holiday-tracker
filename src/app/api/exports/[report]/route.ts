import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { clientIp } from "@/server/lib/request";
import { writeAudit } from "@/server/modules/audit/service";
import { reportCsv, reportXlsx } from "@/server/modules/reports/export";
import { runReport } from "@/server/modules/reports/registry";

/** A report as XLSX or CSV with the page's filters (spec §5.10); permission-checked and audited. */
export async function GET(request: Request, ctx: { params: Promise<{ report: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: "password change required" }, { status: 403 });
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  let run;
  try {
    run = runReport(db, user, (await ctx.params).report, Object.fromEntries(url.searchParams));
  } catch (err) {
    if (err instanceof DomainError) return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 403 : 404 });
    throw err;
  }
  const { report, result, params } = run;
  writeAudit(db, {
    actorUserId: user.id, action: "report.export", entityType: "report", entityId: report.slug,
    summary: `Exported ${report.title} (${format.toUpperCase()}, ${result.rows.length} rows)`, diff: { params },
    ip: clientIp(request.headers), userAgent: request.headers.get("user-agent"),
  });
  const filename = `${report.title} ${run.ctx.today}.${format}`;
  const body = format === "csv" ? reportCsv(result) : new Uint8Array(await reportXlsx(report.title, result));
  return new Response(body, {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
