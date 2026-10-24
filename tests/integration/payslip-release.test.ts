import { PDFDocument } from "@cantoo/pdf-lib";
import { and, eq } from "drizzle-orm";
import forge from "node-forge";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailMessage } from "@/server/lib/email";
import type { DB } from "@/server/db/client";
import { files, notifications, payslips, salaryStructures, type EmployeeRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { canAccessFile } from "@/server/modules/files/access";
import { resolveStoredPath } from "@/server/modules/files/service";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { canViewPayslip } from "@/server/modules/payroll/access";
import {
  emailPayslips, payslipPassword, payslipPdfData, preparePayslip, prepareRelease, protectPdf, releasePayslip, releaseRun, renderPayslip,
  type PayslipEnv,
} from "@/server/modules/payroll/payslips";
import { approveRun, computeRun, createRun, requireRun, setPayslipStatus } from "@/server/modules/payroll/runs";
import { reviseSalary } from "@/server/modules/payroll/salaries";
import { seedPayrollDefaults } from "@/server/modules/payroll/structures";
import { patchSetting } from "@/server/modules/settings/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const sent: EmailMessage[] = [];
vi.mock("@/server/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/lib/email")>();
  return {
    ...actual,
    sendEmail: async (message: EmailMessage) => {
      sent.push(message);
      return { sent: true };
    },
  };
});

let db: DB;
let dir: string;
let env: PayslipEnv;
let makerId: number;
let checkerId: number;
let ashaUser: ReturnType<typeof insertUser>;
let asha: EmployeeRow;
let kiran: EmployeeRow;
const after = (period: string) => {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { today: `${next}-02`, now: new Date(`${next}-02T06:00:00Z`) };
};
const NOV = after("2026-11");
const approved = (period: string, hold: number[] = []) => {
  const run = createRun(db, makerId, { period, type: "regular", notes: null }, after(period));
  computeRun(db, makerId, run.id, after(period));
  for (const id of hold) setPayslipStatus(db, run.id, id, "hold");
  return approveRun(db, checkerId, run.id, after(period));
};
const slipOf = (runId: number, employeeId: number) =>
  db.select().from(payslips).where(and(eq(payslips.runId, runId), eq(payslips.employeeId, employeeId))).get()!;
const storedBytes = (fileId: number) => readFileSync(resolveStoredPath(dir, db.select().from(files).where(eq(files.id, fileId)).get()!.storageName));
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const release = async (runId: number, at = NOV) => releaseRun(db, runId, await prepareRelease(db, runId, env, at), { now: at.now, uploadDir: dir });

beforeEach(() => {
  db = createTestDb();
  dir = mkdtempSync(path.join(tmpdir(), "pvcon-payslips-"));
  env = { uploadDir: dir, appUrl: "https://people.pvcon.in", signing: null };
  sent.length = 0;
  seedDefaultShift(db, { attendanceMode: "auto" });
  seedDefaultLeaveTypes(db);
  seedPayrollDefaults(db);
  makerId = insertUser(db, { roles: ["payroll_admin"] }).id;
  checkerId = insertUser(db, { roles: ["super_admin"] }).id;
  ashaUser = insertUser(db, { email: "asha@pvcon.in" });
  asha = insertEmployee(db, { firstName: "Asha", dateOfJoining: "2024-03-15", dateOfBirth: "1990-05-17", userId: ashaUser.id });
  kiran = insertEmployee(db, { firstName: "Kiran", dateOfJoining: "2025-06-01", workEmail: "kiran@pvcon.in" });
  const structureId = db.select().from(salaryStructures).get()!.id;
  for (const e of [asha, kiran]) {
    reviseSalary(db, makerId, { employeeId: e.id, effectiveFrom: "2026-01-01", annualCtc: 120_000_000, structureId, overrides: {}, reason: null });
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("releasing payslips", () => {
  it("freezes each included payslip once, with a code and the SHA-256 of the stored bytes", async () => {
    const run = approved("2026-11", [kiran.id]);
    const prepared = await prepareRelease(db, run.id, env, NOV);
    expect(prepared.map((p) => p.payslipId)).toEqual([slipOf(run.id, asha.id).id]);
    const result = releaseRun(db, run.id, prepared, { now: NOV.now, uploadDir: dir });
    expect(result.run.status).toBe("released");

    const a = slipOf(run.id, asha.id);
    expect(a).toMatchObject({ releasedAt: NOV.now.toISOString(), signed: false });
    expect(a.verificationCode).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    const bytes = storedBytes(a.pdfFileId!);
    expect(bytes.equals(prepared[0]!.pdf)).toBe(true);
    expect(sha256(bytes)).toBe(a.pdfSha256);
    expect(sha256(storedBytes(a.pdfFileId!))).toBe(a.pdfSha256);
    expect((await PDFDocument.load(bytes)).getTitle()).toBe(`Payslip – Asha Test – November 2026`);
    expect(db.select().from(notifications).where(eq(notifications.userId, ashaUser.id)).all().map((n) => [n.type, n.link])).toEqual([
      ["payslip.released", `/me/payslips/${a.id}`],
    ]);
    expectDomainError(() => releaseRun(db, run.id, prepared, { now: NOV.now, uploadDir: dir }), "NOT_APPROVED");

    // The held one goes out later, with its own code.
    const k = slipOf(run.id, kiran.id);
    expect(k.releasedAt).toBeNull();
    expectDomainError(() => releasePayslip(db, a.id, prepared[0]!, { now: NOV.now, uploadDir: dir }), "NOT_HELD");
    const later = releasePayslip(db, k.id, await preparePayslip(db, k.id, env, NOV), { now: NOV.now, uploadDir: dir });
    expect(later).toMatchObject({ status: "ok", releasedAt: NOV.now.toISOString() });
    expect(later.verificationCode).not.toBe(a.verificationCode);
  });

  it("refuses payslips that weren't prepared, and stores nothing for a draft preview", async () => {
    const run = approved("2026-11");
    expectDomainError(() => releaseRun(db, run.id, [], { now: NOV.now, uploadDir: dir }), "NOT_PREPARED");
    expect(requireRun(db, run.id).status).toBe("approved");
    const preview = await renderPayslip(db, slipOf(run.id, asha.id).id, env, { code: null, draft: true, now: NOV.now });
    expect(preview.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(db.select().from(files).all()).toEqual([]);
  });

  it("adds fiscal-year-to-date amounts from released payslips", async () => {
    const oct = approved("2026-10");
    await release(oct.id, after("2026-10"));
    const nov = approved("2026-11");
    const data = await payslipPdfData(db, slipOf(nov.id, asha.id).id, env, { code: "ABCDEFGHJKLM", now: NOV.now });
    expect(data.earnings.map((l) => [l.name, l.amount, l.ytd])).toEqual([
      ["Basic", 5_000_000, 10_000_000], ["House rent allowance", 2_000_000, 4_000_000], ["Special allowance", 3_000_000, 6_000_000],
    ]);
    expect(data).toMatchObject({ fiscalYear: "FY 2026–27", title: "Payslip for November 2026", netInWords: "Rupees One Lakh Only" });
    expect(data.verification).toMatchObject({ code: "ABCDEFGHJKLM", url: "https://people.pvcon.in/verify/ABCDEFGHJKLM" });
  });
});

describe("who sees a payslip", () => {
  it("is payroll and salary viewers, and the employee once released", async () => {
    const run = approved("2026-11");
    const own = sessionUserFor(db, ashaUser);
    const peer = sessionUserFor(db, insertUser(db));
    const payroll = sessionUserFor(db, insertUser(db, { roles: ["payroll_admin"] }));
    expect([own, peer, payroll].map((u) => canViewPayslip(u, slipOf(run.id, asha.id)))).toEqual([false, false, true]);
    await release(run.id);
    expect([own, peer, payroll].map((u) => canViewPayslip(u, slipOf(run.id, asha.id)))).toEqual([true, false, true]);
    const file = db.select().from(files).where(eq(files.id, slipOf(run.id, asha.id).pdfFileId!)).get()!;
    expect([own, peer, payroll].map((u) => canAccessFile(db, u, file))).toEqual([true, false, true]);
  });
});

describe("emailed copies", () => {
  it("use the date of birth, else the employee code, as the password", () => {
    expect(payslipPassword(asha, "dob_ddmmyyyy")).toBe("17051990");
    expect(payslipPassword(kiran, "dob_ddmmyyyy")).toBe(kiran.employeeCode);
    expect(payslipPassword(asha, "employee_code")).toBe(asha.employeeCode);
  });

  it("can't be opened without the password", async () => {
    const run = approved("2026-11");
    const { payslipIds } = await release(run.id);
    const original = storedBytes(slipOf(run.id, asha.id).pdfFileId!);
    const locked = await protectPdf(original, "17051990");
    await expect(PDFDocument.load(locked)).rejects.toThrow(/encrypted/i);
    expect((await PDFDocument.load(locked, { password: "17051990" })).getPageCount()).toBe(1);

    patchSetting(db, "payroll", { emailAttachment: "protected" }, null);
    expect(await emailPayslips(db, payslipIds, env, NOV)).toBe(2);
    expect(sent.map((m) => [m.to, m.subject, m.attachments?.length])).toEqual([
      ["asha@pvcon.in", "Your payslip for November 2026", 1], ["kiran@pvcon.in", "Your payslip for November 2026", 1],
    ]);
    await expect(PDFDocument.load(sent[0]!.attachments![0]!.content)).rejects.toThrow(/encrypted/i);
    expect(sent[0]!.text).toContain("date of birth as DDMMYYYY");
    expect(sent[1]!.text).toContain("employee code");
    expect(slipOf(run.id, asha.id).emailedAt).toBe(NOV.now.toISOString());
  });
});

describe("signing", () => {
  it("signs released payslips with the configured certificate, over the whole file", async () => {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date("2026-01-01");
    cert.validity.notAfter = new Date("2028-01-01");
    const subject = [{ name: "commonName", value: "PVCON Consulting" }];
    cert.setSubject(subject);
    cert.setIssuer(subject);
    cert.sign(keys.privateKey, forge.md.sha256.create());
    const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], "secret", { algorithm: "3des" });
    const p12Path = path.join(dir, "signing.p12");
    writeFileSync(p12Path, Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary"));

    const run = approved("2026-11");
    const prepared = await prepareRelease(db, run.id, { ...env, signing: { p12Path, passphrase: "secret" } }, NOV);
    expect(prepared[0]!.signed).toBe(true);
    const pdf = prepared[0]!.pdf;
    const text = pdf.toString("latin1");
    const [, a, b, c, d] = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/.exec(text)!.map(Number) as number[];
    expect([a, c! + d!]).toEqual([0, pdf.length]);
    expect(text.slice(b!, b! + 2)).toBe("<3");
    expect(text).toContain("/SubFilter /adbe.pkcs7.detached");
    releaseRun(db, run.id, prepared, { now: NOV.now, uploadDir: dir });
    expect(slipOf(run.id, asha.id).signed).toBe(true);
  }, 30_000);
});
