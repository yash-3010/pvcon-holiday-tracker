import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/server/auth/session";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { getFile, resolveStoredPath } from "@/server/modules/files/service";
import { canViewPayslip } from "@/server/modules/payroll/access";
import { payslipEnv } from "@/server/modules/payroll/env";
import { renderPayslip, requirePayslip } from "@/server/modules/payroll/payslips";

const pdfResponse = (data: Uint8Array, filename: string, inline: boolean) =>
  new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

/**
 * A released payslip's stored PDF, byte for byte (spec §5.6 "Payslips"). `?preview=1` renders an unstored DRAFT for
 * payroll admins before release.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.mustChangePassword) return NextResponse.json({ error: "password change required" }, { status: 403 });
  const id = Number((await ctx.params).id);
  let payslip;
  try {
    payslip = Number.isInteger(id) ? requirePayslip(db, id) : null;
  } catch {
    payslip = null;
  }
  if (!payslip || !canViewPayslip(user, payslip)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const params = new URL(request.url).searchParams;
  const inline = params.get("inline") === "1";
  const name = `Payslip ${payslip.snapshot.code} ${payslip.id}.pdf`;

  if (params.get("preview") === "1") {
    if (!can(user, "payroll.run")) return NextResponse.json({ error: "not found" }, { status: 404 });
    const pdf = await renderPayslip(
      db,
      payslip.id,
      payslipEnv({ sign: false }),
      { code: null, draft: true, now: new Date() },
    );
    return pdfResponse(pdf, `DRAFT ${name}`, true);
  }
  const file = payslip.pdfFileId ? getFile(db, payslip.pdfFileId) : undefined;
  if (!file) return NextResponse.json({ error: "not released" }, { status: 404 });
  const data = await readFile(resolveStoredPath(config.uploadDir, file.storageName));
  return pdfResponse(data, name, inline);
}
