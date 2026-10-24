import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { formatPeriod } from "@/lib/dates";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { clientIp } from "@/server/lib/request";
import { writeAudit } from "@/server/modules/audit/service";
import { bankAdvice, bankAdviceCsv, bankAdviceXlsx, registerXlsx } from "@/server/modules/payroll/exports";
import { requireRun } from "@/server/modules/payroll/inputs";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const KINDS = { "bank-xlsx": "bank advice (XLSX)", "bank-csv": "bank advice (CSV)", register: "register" } as const;

/** Bank advice (XLSX or CSV) and the payroll register of a run, for `payroll.run`; every export is audited. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.mustChangePassword || !can(user, "payroll.run")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const kind = new URL(request.url).searchParams.get("kind") ?? "";
  if (!(kind in KINDS)) return NextResponse.json({ error: "unknown export" }, { status: 400 });
  const id = Number((await ctx.params).id);
  let run;
  try {
    run = requireRun(db, id);
  } catch (err) {
    if (err instanceof DomainError) return NextResponse.json({ error: "not found" }, { status: 404 });
    throw err;
  }

  let body: Buffer | string;
  let type: string;
  let filename: string;
  if (kind === "register") {
    body = await registerXlsx(db, run.id);
    type = XLSX;
    filename = `Payroll register ${run.period}.xlsx`;
  } else if (kind === "bank-csv") {
    body = `﻿${bankAdviceCsv(bankAdvice(db, run.id))}`;
    type = "text/csv; charset=utf-8";
    filename = `Bank advice ${run.period}.csv`;
  } else {
    body = await bankAdviceXlsx(bankAdvice(db, run.id), formatPeriod(run.period));
    type = XLSX;
    filename = `Bank advice ${run.period}.xlsx`;
  }
  writeAudit(db, {
    actorUserId: user.id, action: "payroll.export", entityType: "payroll_run", entityId: run.id,
    summary: `Exported the ${KINDS[kind as keyof typeof KINDS]} of the ${formatPeriod(run.period)} run`,
    ip: clientIp(request.headers), userAgent: request.headers.get("user-agent"),
  });
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
