import { eq } from "drizzle-orm";
import { dateInTimeZone, formatPeriod, type ISODate } from "@/lib/dates";
import type { Minor } from "@/lib/money";
import type { DbLike } from "@/server/db/client";
import { payrollRuns, payslips, payslipVerifications } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createRateLimiter, type RateLimiter } from "@/server/lib/rate-limit";
import { getSetting } from "@/server/modules/settings/service";

/** Public lookups: 30 per 15 minutes per address (spec §5.6 "Verification"). */
export const verificationLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 30 });

const CODE = /^[A-HJ-NP-Z2-9]{12}$/;

/** "Yash Sharma" → "Y*** S***". */
export function maskName(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}***`)
    .join(" ");
}

export interface VerificationResult {
  company: string;
  maskedName: string;
  /** "November 2026". */
  period: string;
  issuedOn: ISODate;
  /** Whether a typed net pay matches; null when none was typed. The net pay itself is never shown. */
  matched: boolean | null;
}

/**
 * Looks up a released payslip by its verification code for the public verify page and logs the lookup. Codes are
 * matched without case, spaces or dashes. Unknown codes and unreleased payslips give null.
 */
export function lookupPayslip(
  db: DbLike,
  rawCode: string,
  { ip, userAgent, netPay }: { ip: string | null; userAgent: string | null; netPay: Minor | null },
  { limiter = verificationLimiter }: { limiter?: RateLimiter } = {},
): VerificationResult | null {
  if (!limiter.check(ip ?? "unknown")) throw new DomainError("RATE_LIMITED", "Too many checks from this network. Try again in a few minutes.");
  const code = rawCode.toUpperCase().replace(/[\s-]/g, "");
  if (!CODE.test(code)) return null;
  const row = db
    .select({ payslip: payslips, period: payrollRuns.period })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .where(eq(payslips.verificationCode, code))
    .get();
  if (!row?.payslip.releasedAt) return null;
  const matched = netPay === null ? null : netPay === row.payslip.netPay;
  db.insert(payslipVerifications)
    .values({ payslipId: row.payslip.id, ip, userAgent: userAgent?.slice(0, 300) ?? null, amountChecked: netPay !== null, matched })
    .run();
  return {
    company: getSetting(db, "company").legalName,
    maskedName: maskName(row.payslip.snapshot.name),
    period: formatPeriod(row.period),
    issuedOn: dateInTimeZone(new Date(row.payslip.releasedAt), getSetting(db, "locale").timezone),
    matched,
  };
}
