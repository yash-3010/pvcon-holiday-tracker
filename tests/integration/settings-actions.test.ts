import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { getFile, resolveStoredPath } from "@/server/modules/files/service";
import { getSetting } from "@/server/modules/settings/service";
import { createTestDb } from "../helpers/db";
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

import {
  removeCompanyLogo,
  updateCompanyProfile,
  updateLocaleSettings,
  uploadCompanyLogo,
} from "@/app/(app)/settings/company/actions";
import { updateSecuritySettings } from "@/app/(app)/settings/security/actions";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
let admin: SessionUser;
let hr: SessionUser;
let uploadDir: string;

function logoForm(data: Buffer | string, name = "logo.png"): FormData {
  const form = new FormData();
  form.set("file", new File([typeof data === "string" ? data : new Uint8Array(data)], name));
  return form;
}

beforeEach(() => {
  state.db = createTestDb();
  admin = sessionUserFor(state.db, insertUser(state.db, { roles: ["super_admin"] }));
  hr = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
  state.user = admin;
  uploadDir = mkdtempSync(path.join(tmpdir(), "pvcon-logo-"));
  vi.stubEnv("UPLOAD_DIR", uploadDir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(uploadDir, { recursive: true, force: true });
});

describe("company settings actions", () => {
  it("saves the company profile and audits the change", async () => {
    const result = await updateCompanyProfile({ legalName: "PVCON Consulting LLP", displayName: "PVCON", address: "Pune" });

    expect(result.ok).toBe(true);
    expect(getSetting(state.db, "company")).toMatchObject({ legalName: "PVCON Consulting LLP", address: "Pune", logoFileId: null });
    const entry = state.db.select().from(auditLogs).where(eq(auditLogs.entityId, "company")).get();
    expect(entry?.diff).toEqual({
      legalName: { from: "PVCON Consulting", to: "PVCON Consulting LLP" },
      address: { from: "", to: "Pune" },
    });
  });

  it("forbids users without settings.manage", async () => {
    state.user = hr;
    await expect(updateCompanyProfile({ legalName: "X", displayName: "X", address: "" })).resolves.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateLocaleSettings({ timezone: "UTC", currency: "USD", fiscalYearStartMonth: 1 })).resolves.toMatchObject({ code: "FORBIDDEN" });
    await expect(uploadCompanyLogo(logoForm(PNG))).resolves.toMatchObject({ code: "FORBIDDEN" });
    await expect(removeCompanyLogo({})).resolves.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateSecuritySettings({ lockoutAttempts: 3, lockoutMinutes: 1, passwordMinLength: 8 })).resolves.toMatchObject({ code: "FORBIDDEN" });
    expect(getSetting(state.db, "company").legalName).toBe("PVCON Consulting");
  });

  it("rejects an unknown time zone with a field error and keeps the old value", async () => {
    const result = await updateLocaleSettings({ timezone: "Mars/Olympus", currency: "INR", fiscalYearStartMonth: 4 });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { timezone: ["Unknown time zone"] } });
    expect(getSetting(state.db, "locale").timezone).toBe("Asia/Kolkata");
  });

  it("stores an uploaded PNG as the company logo and removes it again", async () => {
    const result = await uploadCompanyLogo(logoForm(PNG));

    expect(result.ok).toBe(true);
    const logoFileId = getSetting(state.db, "company").logoFileId!;
    expect(result).toEqual({ ok: true, data: { logoFileId } });
    const file = getFile(state.db, logoFileId)!;
    expect(file).toMatchObject({ mime: "image/png", uploadedBy: admin.id });
    expect(existsSync(resolveStoredPath(uploadDir, file.storageName))).toBe(true);

    await expect(removeCompanyLogo({})).resolves.toMatchObject({ ok: true });
    expect(getSetting(state.db, "company").logoFileId).toBeNull();
  });

  it("rejects logos that are missing, not images or larger than 2 MB", async () => {
    await expect(uploadCompanyLogo(new FormData())).resolves.toMatchObject({ ok: false, code: "NO_FILE" });
    await expect(uploadCompanyLogo(logoForm("%PDF-1.7 pretending", "logo.png"))).resolves.toMatchObject({ ok: false, code: "FILE_TYPE" });
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    await expect(uploadCompanyLogo(logoForm(big))).resolves.toMatchObject({ ok: false, code: "FILE_TOO_LARGE" });
    expect(getSetting(state.db, "company").logoFileId).toBeNull();
  });
});

describe("security settings action", () => {
  it("saves valid lockout and password rules", async () => {
    await expect(updateSecuritySettings({ lockoutAttempts: 8, lockoutMinutes: 30, passwordMinLength: 12 })).resolves.toMatchObject({ ok: true });
    expect(getSetting(state.db, "security")).toEqual({ lockoutAttempts: 8, lockoutMinutes: 30, passwordMinLength: 12 });
  });

  it("rejects out-of-range values", async () => {
    const result = await updateSecuritySettings({ lockoutAttempts: 2, lockoutMinutes: 30, passwordMinLength: 12 });
    expect(result).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(result.ok === false && result.fieldErrors?.lockoutAttempts?.length).toBeTruthy();
    expect(getSetting(state.db, "security").lockoutAttempts).toBe(5);
  });
});
