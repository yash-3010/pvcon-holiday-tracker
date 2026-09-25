import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/permissions";
import type { DB } from "@/server/db/client";
import { employees, type EmployeeRow, type FileRow } from "@/server/db/schema";
import { addEmployeeDocument, deleteEmployeeDocument, listEmployeeDocuments } from "@/server/modules/employees/documents";
import { canAccessFile } from "@/server/modules/files/access";
import { saveUpload } from "@/server/modules/files/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const PDF = Buffer.from("%PDF-1.7 employee document");
let db: DB;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = mkdtempSync(path.join(tmpdir(), "pvcon-docs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const upload = (uploadedBy: number | null): FileRow =>
  saveUpload(db, { data: PDF, originalName: "Offer Letter.pdf", allowed: ["pdf"], uploadedBy, uploadDir: dir });

/** A session for a new user, optionally linked to `employee`. */
function sessionAs(employee: EmployeeRow | null, roles: Role[] = ["employee"]) {
  const user = insertUser(db, { roles });
  if (employee) db.update(employees).set({ userId: user.id }).where(eq(employees.id, employee.id)).run();
  return sessionUserFor(db, user);
}

describe("employee documents", () => {
  it("adds, lists and deletes documents", () => {
    const hrUser = insertUser(db, { roles: ["hr_admin"], name: "Hari Rao" });
    const asha = insertEmployee(db);
    const file = upload(hrUser.id);
    const doc = addEmployeeDocument(db, { employeeId: asha.id, category: "offer_letter", title: "Offer letter", fileId: file.id, uploadedBy: hrUser.id });
    expect(listEmployeeDocuments(db, asha.id)).toEqual([
      {
        id: doc.id, employeeId: asha.id, fileId: file.id, category: "offer_letter", title: "Offer letter",
        originalName: "Offer Letter.pdf", size: PDF.length, mime: "application/pdf", uploadedByName: "Hari Rao", createdAt: doc.createdAt,
      },
    ]);
    expect(deleteEmployeeDocument(db, doc.id).id).toBe(doc.id);
    expect(listEmployeeDocuments(db, asha.id)).toEqual([]);
    expectDomainError(() => deleteEmployeeDocument(db, doc.id), "NOT_FOUND");
    expectDomainError(
      () => addEmployeeDocument(db, { employeeId: 9999, category: "other", title: "x", fileId: file.id, uploadedBy: null }),
      "NOT_FOUND",
    );
  });
});

describe("document file access", () => {
  it("allows the employee, HR and org-wide viewers, but not managers above or peers", () => {
    const ceo = insertEmployee(db);
    const asha = insertEmployee(db, { reportingManagerId: ceo.id });
    const kiran = insertEmployee(db, { reportingManagerId: asha.id });
    const meera = insertEmployee(db, { reportingManagerId: ceo.id });
    const file = upload(null);
    addEmployeeDocument(db, { employeeId: kiran.id, category: "id_proof", title: "PAN card", fileId: file.id, uploadedBy: null });

    expect(canAccessFile(db, sessionAs(kiran), file)).toBe(true);
    // Documents are as private as Bank & IDs: a manager above does not get them, even though they can view the profile.
    expect(canAccessFile(db, sessionAs(asha), file)).toBe(false);
    expect(canAccessFile(db, sessionAs(ceo), file)).toBe(false);
    expect(canAccessFile(db, sessionAs(meera), file)).toBe(false);
    expect(canAccessFile(db, sessionAs(null, ["hr_admin"]), file)).toBe(true);
    expect(canAccessFile(db, sessionAs(null, ["payroll_admin"]), file)).toBe(true);
    expect(canAccessFile(db, sessionAs(null), file)).toBe(false);
  });

  it("gives nothing extra for files that are not employee documents", () => {
    const loose = upload(null);
    expect(canAccessFile(db, sessionAs(insertEmployee(db)), loose)).toBe(false);
  });
});
