"use server";

import { headers } from "next/headers";
import { toMinor } from "@/lib/money";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { clientIp } from "@/server/lib/request";
import { lookupPayslip } from "@/server/modules/payroll/verify";

export interface NetPayCheckState {
  matched?: boolean;
  error?: string;
}

/** Compares the net pay printed on a payslip with the issued one; the answer is only match or no match. */
export async function checkNetPayAction(_prev: NetPayCheckState, formData: FormData): Promise<NetPayCheckState> {
  const typed = Number(String(formData.get("netPay") ?? "").replace(/[,\s₹]/g, ""));
  if (!Number.isFinite(typed) || typed < 0 || typed > 100_000_000) return { error: "Enter the net pay shown on the payslip." };
  const h = await headers();
  try {
    const result = lookupPayslip(db, String(formData.get("code") ?? ""), {
      ip: clientIp(h), userAgent: h.get("user-agent"), netPay: toMinor(typed),
    });
    if (!result) return { error: "This code doesn't match any payslip." };
    return { matched: result.matched === true };
  } catch (err) {
    if (err instanceof DomainError) return { error: err.message };
    throw err;
  }
}
