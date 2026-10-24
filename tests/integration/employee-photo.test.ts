import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, employees, type EmployeeRow } from "@/server/db/schema";
import { canAccessFile } from "@/server/modules/files/access";
import { getFile, saveUpload } from "@/server/modules/files/service";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

// Only the Next.js runtime boundary is replaced.
const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { removeEmployeePhotoAction, uploadEmployeePhotoAction } from "@/app/(app)/org/employees/actions";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
let uploadDir: string;
let asha: EmployeeRow, ravi: EmployeeRow;
let ashaUser: SessionUser, raviUser: SessionUser, hr: SessionUser;

function photoForm(employeeId: number, data: Buffer | string = PNG, name = "me.png"): FormData {
  const form = new FormData();
  form.set("employeeId", String(employeeId));
  form.set("file", new File([typeof data === "string" ? data : new Uint8Array(data)], name));
  return form;
}
const photoOf = (e: EmployeeRow) => state.db.select({ id: employees.photoFileId }).from(employees).where(eq(employees.id, e.id)).get()!.id;

beforeEach(() => {
  state.db = createTestDb();
  uploadDir = mkdtempSync(path.join(tmpdir(), "pvcon-photo-"));
  vi.stubEnv("UPLOAD_DIR", uploadDir);
  const ashaLogin = insertUser(state.db);
  const raviLogin = insertUser(state.db);
  asha = insertEmployee(state.db, { firstName: "Asha", userId: ashaLogin.id });
  ravi = insertEmployee(state.db, { firstName: "Ravi", userId: raviLogin.id });
  ashaUser = sessionUserFor(state.db, getUserById(state.db, ashaLogin.id)!);
  raviUser = sessionUserFor(state.db, getUserById(state.db, raviLogin.id)!);
  hr = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
  state.user = ashaUser;
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("employee photos", () => {
  it("lets employees set and remove their own photo, audited", async () => {
    const result = await uploadEmployeePhotoAction(photoForm(asha.id));
    expect(result).toMatchObject({ ok: true });
    const fileId = photoOf(asha)!;
    expect(getFile(state.db, fileId)).toMatchObject({ mime: "image/png", uploadedBy: ashaUser.id });
    expect(state.db.select().from(auditLogs).where(eq(auditLogs.action, "employee.photo")).all()).toHaveLength(1);

    await expect(removeEmployeePhotoAction({ employeeId: asha.id })).resolves.toMatchObject({ ok: true });
    expect(photoOf(asha)).toBeNull();
  });

  it("lets HR change anyone's photo, but not colleagues each other's", async () => {
    await expect(uploadEmployeePhotoAction(photoForm(ravi.id))).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(removeEmployeePhotoAction({ employeeId: ravi.id })).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    state.user = hr;
    await expect(uploadEmployeePhotoAction(photoForm(ravi.id))).resolves.toMatchObject({ ok: true });
    expect(photoOf(ravi)).not.toBeNull();
  });

  it("accepts only small images", async () => {
    await expect(uploadEmployeePhotoAction(photoForm(asha.id, "%PDF-1.7 pretending", "me.png"))).resolves.toMatchObject({ ok: false, code: "FILE_TYPE" });
    await expect(uploadEmployeePhotoAction(photoForm(asha.id, Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)])))).resolves.toMatchObject({
      ok: false, code: "FILE_TOO_LARGE",
    });
    const empty = new FormData();
    empty.set("employeeId", String(asha.id));
    await expect(uploadEmployeePhotoAction(empty)).resolves.toMatchObject({ ok: false, code: "NO_FILE" });
    expect(photoOf(asha)).toBeNull();
  });

  it("shows a photo to every colleague, unlike other people's files", async () => {
    await uploadEmployeePhotoAction(photoForm(asha.id));
    const photo = getFile(state.db, photoOf(asha)!)!;
    expect(canAccessFile(state.db, raviUser, photo)).toBe(true);
    const other = saveUpload(state.db, { data: PNG, originalName: "x.png", allowed: ["png"], uploadedBy: ashaUser.id, uploadDir });
    expect(canAccessFile(state.db, raviUser, other)).toBe(false);
  });
});
