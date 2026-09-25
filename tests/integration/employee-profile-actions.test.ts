import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, employeeChecklists, employees, type EmployeeRow } from "@/server/db/schema";
import { seedDefaultChecklistTemplates } from "@/server/modules/employees/checklists";
import { listEmployeeDocuments } from "@/server/modules/employees/documents";
import { createEmployee } from "@/server/modules/employees/service";
import { createTestDb } from "../helpers/db";
import { employeeInput } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import {
  createEmployeeLoginAction, deleteEmployeeDocumentAction, linkEmployeeUserAction, recordResignationAction,
  toggleChecklistItemAction, updateEmployeeBankAction, updateEmployeeJobAction, uploadEmployeeDocumentAction,
  withdrawResignationAction,
} from "@/app/(app)/org/employees/actions";

const PDF = new Uint8Array(Buffer.from("%PDF-1.7 scanned document"));
const none = { login: { mode: "none" as const }, onboarding: false };
let dir: string;
let hr: SessionUser;
let asha: EmployeeRow;
let ravi: EmployeeRow;

/** A session for a new user, optionally linked to `employee`. */
function sessionAs(employee: EmployeeRow | null, roles: Role[] = ["employee"]): SessionUser {
  const user = insertUser(state.db, { roles });
  if (employee) state.db.update(employees).set({ userId: user.id }).where(eq(employees.id, employee.id)).run();
  return sessionUserFor(state.db, user);
}

const jobOf = (row: EmployeeRow) => ({
  departmentId: row.departmentId, designationId: row.designationId, reportingManagerId: row.reportingManagerId,
  employmentType: row.employmentType, workLocation: row.workLocation, dateOfJoining: row.dateOfJoining,
  probationEndDate: row.probationEndDate, confirmationDate: row.confirmationDate, noticePeriodDays: row.noticePeriodDays,
});

function docForm(employeeId: number, category: string, title = "Scanned copy", withFile = true): FormData {
  const form = new FormData();
  form.set("employeeId", String(employeeId));
  form.set("category", category);
  form.set("title", title);
  if (withFile) form.set("file", new File([PDF], "scan.pdf"));
  return form;
}

beforeEach(() => {
  state.db = createTestDb();
  seedDefaultChecklistTemplates(state.db);
  dir = mkdtempSync(path.join(tmpdir(), "pvcon-profile-"));
  vi.stubEnv("UPLOAD_DIR", dir);
  hr = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
  asha = createEmployee(state.db, hr, employeeInput({ workEmail: "asha@pvcon.in" }), none);
  ravi = createEmployee(
    state.db, hr,
    employeeInput({ firstName: "Ravi", lastName: "Menon", workEmail: "ravi@pvcon.in", reportingManagerId: asha.id }),
    { ...none, onboarding: true },
  );
  state.user = hr;
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("job, bank and exit actions", () => {
  it("lets HR update job details but not the employee", async () => {
    await expect(updateEmployeeJobAction({ ...jobOf(ravi), workLocation: "Pune", employeeId: ravi.id, effectiveDate: "2026-11-01" })).resolves.toMatchObject({ ok: true });
    state.user = sessionAs(ravi);
    await expect(updateEmployeeJobAction({ ...jobOf(ravi), employeeId: ravi.id, effectiveDate: "2026-11-01" })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("needs sensitive access to edit bank details and never writes them to the audit log in clear text", async () => {
    const bank = { bankName: "HDFC Bank", bankAccount: "444455556666", bankIfsc: "HDFC0001234", pan: null, aadhaar: null, passport: null };
    await expect(updateEmployeeBankAction({ ...bank, employeeId: ravi.id })).resolves.toMatchObject({ ok: true });
    expect(JSON.stringify(state.db.select().from(auditLogs).all())).not.toContain("444455556666");
    state.user = sessionAs(null, ["payroll_admin"]);
    await expect(updateEmployeeBankAction({ ...bank, employeeId: ravi.id })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("records and withdraws resignations for employee.exit holders only", async () => {
    const resignation = { employeeId: ravi.id, resignationDate: "2026-11-01", lastWorkingDate: "2026-11-30", exitReason: "" };
    await expect(recordResignationAction(resignation)).resolves.toMatchObject({ ok: true });
    await expect(withdrawResignationAction({ employeeId: ravi.id })).resolves.toMatchObject({ ok: true });
    state.user = sessionAs(asha, ["employee", "manager"]);
    await expect(recordResignationAction(resignation)).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("login actions", () => {
  it("creates a login with a temporary password, but only for an allowed work email", async () => {
    await expect(createEmployeeLoginAction({ employeeId: ravi.id, roles: ["employee"] })).resolves.toMatchObject({
      ok: true, data: { email: "ravi@pvcon.in" },
    });
    const outsider = createEmployee(state.db, hr, employeeInput({ firstName: "Out", workEmail: "out@gmail.com" }), none);
    await expect(createEmployeeLoginAction({ employeeId: outsider.id, roles: ["employee"] })).resolves.toMatchObject({ code: "EMAIL_DOMAIN" });
  });

  it("links an existing login; employees cannot", async () => {
    await expect(linkEmployeeUserAction({ employeeId: asha.id, userId: insertUser(state.db).id })).resolves.toMatchObject({ ok: true });
    state.user = sessionAs(ravi);
    await expect(linkEmployeeUserAction({ employeeId: ravi.id, userId: insertUser(state.db).id })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("document actions", () => {
  it("lets HR upload any category and employees only their own ID-type documents", async () => {
    await expect(uploadEmployeeDocumentAction(docForm(ravi.id, "offer_letter", "Offer letter"))).resolves.toMatchObject({ ok: true });
    state.user = sessionAs(ravi);
    await expect(uploadEmployeeDocumentAction(docForm(ravi.id, "id_proof", "PAN card"))).resolves.toMatchObject({ ok: true });
    await expect(uploadEmployeeDocumentAction(docForm(ravi.id, "contract"))).resolves.toMatchObject({ code: "FORBIDDEN" });
    await expect(uploadEmployeeDocumentAction(docForm(asha.id, "id_proof"))).resolves.toMatchObject({ code: "FORBIDDEN" });
    expect(listEmployeeDocuments(state.db, ravi.id).map((d) => d.title).sort()).toEqual(["Offer letter", "PAN card"]);
  });

  it("validates the title and the file", async () => {
    await expect(uploadEmployeeDocumentAction(docForm(ravi.id, "offer_letter", "x"))).resolves.toMatchObject({
      ok: false, code: "VALIDATION", fieldErrors: { title: ["At least 2 characters"] },
    });
    await expect(uploadEmployeeDocumentAction(docForm(ravi.id, "offer_letter", "Offer", false))).resolves.toMatchObject({ code: "NO_FILE" });
  });

  it("lets only document.manage holders delete", async () => {
    const uploaded = await uploadEmployeeDocumentAction(docForm(ravi.id, "offer_letter"));
    if (!uploaded.ok) throw new Error(uploaded.error);
    state.user = sessionAs(ravi);
    await expect(deleteEmployeeDocumentAction({ documentId: uploaded.data.id })).resolves.toMatchObject({ code: "FORBIDDEN" });
    state.user = hr;
    await expect(deleteEmployeeDocumentAction({ documentId: uploaded.data.id })).resolves.toMatchObject({ ok: true });
  });
});

describe("checklist action", () => {
  it("lets the employee, managers above them and HR tick items, but not a peer", async () => {
    const checklist = state.db.select().from(employeeChecklists).where(eq(employeeChecklists.employeeId, ravi.id)).get()!;
    const tick = (index: number) => toggleChecklistItemAction({ checklistId: checklist.id, index, done: true });
    state.user = sessionAs(ravi);
    await expect(tick(0)).resolves.toMatchObject({ ok: true });
    state.user = sessionAs(asha);
    await expect(tick(1)).resolves.toMatchObject({ ok: true });
    state.user = sessionAs(createEmployee(state.db, hr, employeeInput({ firstName: "Meera" }), none));
    await expect(tick(2)).resolves.toMatchObject({ code: "FORBIDDEN" });
    state.user = hr;
    await expect(tick(2)).resolves.toMatchObject({ ok: true });
  });
});
