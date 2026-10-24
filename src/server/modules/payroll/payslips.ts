import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFInvalidObject, PDFName, PDFNumber, PDFString } from "@cantoo/pdf-lib";
import { SignPdf } from "@signpdf/signpdf";
import { P12Signer } from "@signpdf/signer-p12";
import { ANNOTATION_FLAGS, DEFAULT_BYTE_RANGE_PLACEHOLDER, DEFAULT_SIGNATURE_LENGTH, SIG_FLAGS, SUBFILTER_ADOBE_PKCS7_DETACHED } from "@signpdf/utils";
import { and, eq, gte, inArray, isNotNull, lte, ne, or } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import QRCode from "qrcode";
import { dateInTimeZone, fiscalYearOf, formatDate, formatPeriod } from "@/lib/dates";
import { amountInWords, type Minor } from "@/lib/money";
import type { DbLike } from "@/server/db/client";
import {
  employees, files, payrollRuns, payslipLines, payslips, users, type EmployeeRow, type PayrollRunRow, type PayslipRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { renderEmail, sendEmail } from "@/server/lib/email";
import { logger } from "@/server/lib/logger";
import { resolveStoredPath, saveUpload } from "@/server/modules/files/service";
import { notify } from "@/server/modules/notifications/service";
import { getSetting } from "@/server/modules/settings/service";
import { requireRun } from "./inputs";
import { renderPayslipPdf, type PayslipPdfData, type PayslipPdfLine, type PdfImage } from "./payslip-pdf";

/** Where files live and how released payslips are verified and signed. */
export interface PayslipEnv {
  uploadDir: string;
  appUrl: string;
  /** A PKCS#12 document-signing certificate; released payslips are signed when it is set (spec §5.6 "Payslips"). */
  signing: { p12Path: string; passphrase: string } | null;
}

export function requirePayslip(db: DbLike, id: number): PayslipRow {
  const row = db.select().from(payslips).where(eq(payslips.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Payslip not found.");
  return row;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A random 12-character verification code without look-alike characters. */
export function newVerificationCode(): string {
  return Array.from({ length: 12 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
}

export const verifyUrl = (appUrl: string, code: string) => `${appUrl}/verify/${code}`;

async function imageFile(db: DbLike, uploadDir: string, fileId: number | null): Promise<PdfImage | null> {
  if (!fileId) return null;
  const file = db.select().from(files).where(eq(files.id, fileId)).get();
  const format = file?.mime === "image/png" ? "png" : file?.mime === "image/jpeg" ? "jpg" : null;
  if (!file || !format) return null;
  try {
    return { data: await readFile(resolveStoredPath(uploadDir, file.storageName)), format };
  } catch (err) {
    logger.warn({ err, fileId }, "payslip image missing");
    return null;
  }
}

/** The payslip as its PDF shows it. YTD sums the fiscal year's released payslips and this one, line by line. */
export async function payslipPdfData(
  db: DbLike,
  payslipId: number,
  env: PayslipEnv,
  { code, now }: { code: string | null; now: Date },
): Promise<PayslipPdfData> {
  const payslip = requirePayslip(db, payslipId);
  const run = requireRun(db, payslip.runId);
  const company = getSetting(db, "company");
  const locale = getSetting(db, "locale");
  const payroll = getSetting(db, "payroll");
  const fy = fiscalYearOf(run.period, locale.fiscalYearStartMonth);

  const lines = db.select().from(payslipLines).where(eq(payslipLines.payslipId, payslip.id)).orderBy(payslipLines.sortOrder).all();
  const earlier = db
    .select({ code: payslipLines.componentCode, name: payslipLines.componentName, amount: payslipLines.amount })
    .from(payslipLines)
    .innerJoin(payslips, eq(payslips.id, payslipLines.payslipId))
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .where(
      and(
        eq(payslips.employeeId, payslip.employeeId),
        isNotNull(payslips.releasedAt),
        ne(payslips.id, payslip.id),
        gte(payrollRuns.period, fy.start),
        lte(payrollRuns.period, run.period),
      ),
    )
    .all();
  const ytd = new Map<string, Minor>();
  const key = (l: { code: string; name: string }) => `${l.code}|${l.name}`;
  for (const l of [...earlier, ...lines.map((x) => ({ code: x.componentCode, name: x.componentName, amount: x.amount }))]) {
    ytd.set(key(l), (ytd.get(key(l)) ?? 0) + l.amount);
  }
  const section = (kind: string): PayslipPdfLine[] =>
    lines
      .filter((l) => l.kind === kind && l.showOnPayslip)
      .map((l) => ({ name: l.componentName, amount: l.amount, ytd: ytd.get(key({ code: l.componentCode, name: l.componentName }))! }));
  const total = (kind: string) => lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0);

  const month = formatPeriod(run.period);
  const url = code ? verifyUrl(env.appUrl, code) : null;
  return {
    company: { legalName: company.legalName, address: company.address },
    logo: await imageFile(db, env.uploadDir, company.logoFileId),
    title: run.type === "regular" ? `Payslip for ${month}` : `Payslip for ${month} (off-cycle)`,
    documentTitle: `Payslip – ${payslip.snapshot.name} – ${month}`,
    currency: locale.currency,
    employee: payslip.snapshot,
    days: { total: payslip.totalDays, working: payslip.workingDays, paid: payslip.paidDays, lop: payslip.lopDays },
    earnings: section("earning"),
    deductions: section("deduction"),
    reimbursements: section("reimbursement"),
    totalEarnings: total("earning"),
    totalDeductions: payslip.totalDeductions,
    totalReimbursements: payslip.reimbursements,
    netPay: payslip.netPay,
    netInWords: amountInWords(payslip.netPay, locale.currency),
    fiscalYear: fy.label,
    issuedOn: formatDate(dateInTimeZone(now, locale.timezone)),
    footer: payroll.payslipFooter.trim() || null,
    verification: code && url ? { code, url, qr: { data: await QRCode.toBuffer(url, { margin: 1, width: 240 }), format: "png" } } : null,
    signatory: payroll.signatoryEnabled && payroll.signatoryName
      ? {
          name: payroll.signatoryName, designation: payroll.signatoryDesignation,
          image: await imageFile(db, env.uploadDir, payroll.signatoryImageFileId),
        }
      : null,
  };
}

/** Adds an invisible signature field with a zeroed /Contents for `@signpdf/signpdf` to fill. */
async function withSignaturePlaceholder(pdf: Buffer, { reason, name, signingTime }: { reason: string; name: string; signingTime: Date }): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  const page = doc.getPages()[0]!;
  const byteRange = PDFArray.withContext(doc.context);
  byteRange.push(PDFNumber.of(0));
  for (let i = 0; i < 3; i++) byteRange.push(PDFName.of(DEFAULT_BYTE_RANGE_PLACEHOLDER));
  const signature = doc.context.obj({
    Type: "Sig",
    Filter: "Adobe.PPKLite",
    SubFilter: SUBFILTER_ADOBE_PKCS7_DETACHED,
    ByteRange: byteRange,
    Contents: PDFHexString.of("0".repeat(DEFAULT_SIGNATURE_LENGTH * 2)),
    Reason: PDFString.of(reason),
    M: PDFString.fromDate(signingTime),
    Name: PDFString.of(name),
    ContactInfo: PDFString.of(""),
    Location: PDFString.of(""),
  });
  // Written as-is so it never lands in an object stream, where the signer couldn't find it.
  const bytes = new Uint8Array(signature.sizeInBytes());
  signature.copyBytesInto(bytes, 0);
  const signatureRef = doc.context.register(PDFInvalidObject.of(bytes));
  const widget = doc.context.register(
    doc.context.obj({
      Type: "Annot", Subtype: "Widget", FT: "Sig", Rect: [0, 0, 0, 0], V: signatureRef, T: PDFString.of("Signature1"),
      F: ANNOTATION_FLAGS.PRINT, P: page.ref,
    }),
  );
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray) ?? doc.context.obj([]);
  annots.push(widget);
  page.node.set(PDFName.of("Annots"), annots);
  const form = doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict) ?? doc.context.obj({ Fields: [] });
  doc.catalog.set(PDFName.of("AcroForm"), doc.context.register(form));
  form.set(PDFName.of("SigFlags"), PDFNumber.of(SIG_FLAGS.SIGNATURES_EXIST | SIG_FLAGS.APPEND_ONLY));
  const fields = form.lookupMaybe(PDFName.of("Fields"), PDFArray) ?? doc.context.obj([]);
  fields.push(widget);
  form.set(PDFName.of("Fields"), fields);
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Signs a PDF with a PKCS#7 detached signature (PAdES basic) from the PKCS#12 certificate. */
export async function signPdf(pdf: Buffer, signing: NonNullable<PayslipEnv["signing"]>, { name, now }: { name: string; now: Date }): Promise<Buffer> {
  const p12 = await readFile(signing.p12Path);
  const prepared = await withSignaturePlaceholder(pdf, { reason: "Payslip issued", name, signingTime: now });
  return new SignPdf().sign(prepared, new P12Signer(p12, { passphrase: signing.passphrase }), now);
}

/** Renders a payslip; a draft carries a watermark and no verification code, and is never stored. */
export async function renderPayslip(db: DbLike, payslipId: number, env: PayslipEnv, { code, draft, now }: { code: string | null; draft: boolean; now: Date }): Promise<Buffer> {
  return renderPayslipPdf(await payslipPdfData(db, payslipId, env, { code, now }), { draft });
}

export interface PreparedPayslip {
  payslipId: number;
  code: string;
  pdf: Buffer;
  signed: boolean;
}

/** Renders (and signs, when configured) the final PDF of a payslip about to be released. Runs outside transactions. */
export async function preparePayslip(db: DbLike, payslipId: number, env: PayslipEnv, { now }: { now: Date }): Promise<PreparedPayslip> {
  const code = newVerificationCode();
  let pdf = await renderPayslip(db, payslipId, env, { code, draft: false, now });
  if (env.signing) pdf = await signPdf(pdf, env.signing, { name: getSetting(db, "company").legalName, now });
  return { payslipId, code, pdf, signed: !!env.signing };
}

const releasable = (run: PayrollRunRow, payslip: PayslipRow) => payslip.runId === run.id && payslip.status === "ok" && !payslip.releasedAt;

/** The PDFs for releasing an approved run: one per included payslip. */
export async function prepareRelease(db: DbLike, runId: number, env: PayslipEnv, { now }: { now: Date }): Promise<PreparedPayslip[]> {
  const run = requireRun(db, runId);
  if (run.status !== "approved") throw new DomainError("NOT_APPROVED", "Approve the run before releasing it.");
  const ids = db.select().from(payslips).where(eq(payslips.runId, run.id)).all().filter((p) => releasable(run, p)).map((p) => p.id);
  const prepared: PreparedPayslip[] = [];
  for (const id of ids) prepared.push(await preparePayslip(db, id, env, { now }));
  return prepared;
}

function notifyReleased(db: DbLike, payslip: PayslipRow, period: string): void {
  const userId = db.select({ userId: employees.userId }).from(employees).where(eq(employees.id, payslip.employeeId)).get()?.userId;
  if (!userId) return;
  notify(db, { userId, type: "payslip.released", title: `Your payslip for ${formatPeriod(period)} is ready`, link: `/me/payslips/${payslip.id}` });
}

/** Freezes a payslip: stores its PDF once with its SHA-256 and code, and tells the employee. */
function freeze(db: DbLike, run: PayrollRunRow, payslip: PayslipRow, prepared: PreparedPayslip, { now, uploadDir }: { now: Date; uploadDir: string }): PayslipRow {
  const file = saveUpload(db, {
    data: prepared.pdf, originalName: `Payslip ${payslip.snapshot.code} ${run.period}.pdf`, allowed: ["pdf"], uploadedBy: null, uploadDir,
    maxBytes: 20 * 1024 * 1024, now,
  });
  const released = db
    .update(payslips)
    .set({
      status: "ok", releasedAt: now.toISOString(), pdfFileId: file.id, pdfSha256: file.sha256, verificationCode: prepared.code,
      signed: prepared.signed,
    })
    .where(eq(payslips.id, payslip.id))
    .returning()
    .get()!;
  notifyReleased(db, released, run.period);
  return released;
}

/**
 * Releases an approved run (spec §5.6 run step 6) with the PDFs from `prepareRelease`: its included payslips are frozen
 * and become visible to employees. Held payslips wait for `releasePayslip`.
 */
export function releaseRun(
  db: DbLike,
  runId: number,
  prepared: readonly PreparedPayslip[],
  opts: { now: Date; uploadDir: string },
): { run: PayrollRunRow; payslipIds: number[] } {
  const run = requireRun(db, runId);
  if (run.status !== "approved") throw new DomainError("NOT_APPROVED", "Approve the run before releasing it.");
  const byId = new Map(prepared.map((p) => [p.payslipId, p]));
  const due = db.select().from(payslips).where(eq(payslips.runId, run.id)).all().filter((p) => releasable(run, p));
  for (const payslip of due) {
    const doc = byId.get(payslip.id);
    if (!doc) throw new DomainError("NOT_PREPARED", "The payslips changed while they were being prepared. Release again.");
    freeze(db, run, payslip, doc, opts);
  }
  const updated = db.update(payrollRuns).set({ status: "released", releasedAt: opts.now.toISOString() }).where(eq(payrollRuns.id, run.id)).returning().get()!;
  return { run: updated, payslipIds: due.map((p) => p.id) };
}

/** Releases a payslip held when its run was released. */
export function releasePayslip(db: DbLike, payslipId: number, prepared: PreparedPayslip, opts: { now: Date; uploadDir: string }): PayslipRow {
  const payslip = requirePayslip(db, payslipId);
  const run = requireRun(db, payslip.runId);
  if (payslip.status !== "hold" || payslip.releasedAt) throw new DomainError("NOT_HELD", "Only a held payslip can be released on its own.");
  if (run.status !== "released" && run.status !== "paid") throw new DomainError("NOT_RELEASED", "Release the run first.");
  if (prepared.payslipId !== payslip.id) throw new DomainError("NOT_PREPARED", "Prepare this payslip first.");
  return freeze(db, run, payslip, prepared, opts);
}

/** The password of an emailed copy: the date of birth as DDMMYYYY, or the employee code without one. */
export function payslipPassword(employee: Pick<EmployeeRow, "dateOfBirth" | "employeeCode">, format: "dob_ddmmyyyy" | "employee_code"): string {
  if (format === "dob_ddmmyyyy" && employee.dateOfBirth) {
    const [y, m, d] = employee.dateOfBirth.split("-");
    return `${d}${m}${y}`;
  }
  return employee.employeeCode;
}

/** A password-protected copy for email. Encryption would break a signature, so the copy is never signed. */
export async function protectPdf(pdf: Buffer, password: string): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  doc.encrypt({ userPassword: password, ownerPassword: `${password}:${newVerificationCode()}`, permissions: { printing: "highResolution", copying: false, modifying: false } });
  return Buffer.from(await doc.save());
}

/**
 * Emails each employee about their released payslip (an `after` hook): a link to sign in, plus a password-protected copy
 * when `payroll.emailAttachment` is `protected`. Sets `emailed_at` for each email sent.
 */
export async function emailPayslips(db: DbLike, payslipIds: readonly number[], env: PayslipEnv, { now }: { now: Date }): Promise<number> {
  if (!payslipIds.length) return 0;
  const settings = getSetting(db, "payroll");
  const company = getSetting(db, "company");
  const rows = db
    .select({ payslip: payslips, period: payrollRuns.period, employee: employees, userEmail: users.email })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .innerJoin(employees, eq(employees.id, payslips.employeeId))
    .leftJoin(users, eq(users.id, employees.userId))
    .where(and(inArray(payslips.id, [...payslipIds]), isNotNull(payslips.releasedAt), or(isNotNull(employees.workEmail), isNotNull(users.email))))
    .all();
  let sent = 0;
  for (const { payslip, period, employee, userEmail } of rows) {
    const to = employee.workEmail ?? userEmail!;
    const month = formatPeriod(period);
    const paragraphs = [`Hello ${employee.firstName},`, `Your payslip for ${month} from ${company.displayName} is ready.`];
    const attachments = [];
    if (settings.emailAttachment === "protected" && payslip.pdfFileId) {
      const file = db.select().from(files).where(eq(files.id, payslip.pdfFileId)).get()!;
      const pdf = await readFile(resolveStoredPath(env.uploadDir, file.storageName));
      const password = payslipPassword(employee, settings.pdfPasswordFormat);
      attachments.push({ filename: `Payslip ${month}.pdf`, content: await protectPdf(pdf, password), contentType: "application/pdf" });
      paragraphs.push(
        password === employee.employeeCode
          ? "The attached copy opens with your employee code."
          : "The attached copy opens with your date of birth as DDMMYYYY (for example 17051990).",
        "The original, with its verification code, is in My payslips.",
      );
    }
    const { html, text } = renderEmail({
      heading: `Payslip for ${month}`, paragraphs, action: { label: "Open my payslip", url: `${env.appUrl}/me/payslips/${payslip.id}` },
    });
    try {
      const result = await sendEmail({ to, subject: `Your payslip for ${month}`, html, text, attachments });
      if (result.sent) {
        db.update(payslips).set({ emailedAt: now.toISOString() }).where(eq(payslips.id, payslip.id)).run();
        sent += 1;
      }
    } catch (err) {
      logger.error({ err, payslipId: payslip.id }, "payslip email failed");
    }
  }
  return sent;
}

