import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { canAccessFile } from "@/server/modules/files/access";
import { resolveStoredPath, sanitizeFileName, saveUpload, sniffKind } from "@/server/modules/files/service";
import { patchSetting } from "@/server/modules/settings/service";
import { sha256Hex } from "@/server/lib/crypto";
import { createTestDb } from "../helpers/db";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const PDF = Buffer.from("%PDF-1.7\n%test\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
let db: DB;
let dir: string;
beforeEach(() => {
  db = createTestDb();
  dir = mkdtempSync(path.join(tmpdir(), "pvcon-uploads-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("files", () => {
  it("sniffs types from magic bytes", () => {
    expect(sniffKind(PDF, "a.pdf")).toBe("pdf");
    expect(sniffKind(PNG, "a.png")).toBe("png");
    expect(sniffKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "a.jpg")).toBe("jpeg");
    expect(sniffKind(Buffer.from("RIFF0000WEBPVP8 "), "a.webp")).toBe("webp");
    expect(sniffKind(Buffer.from("a,b\n1,2\n"), "data.csv")).toBe("csv");
    expect(sniffKind(Buffer.from("MZ\x90\x00"), "evil.pdf")).toBeNull();
  });

  it("stores allowed uploads with a hash and random storage name", () => {
    const user = insertUser(db);
    const row = saveUpload(db, { data: PDF, originalName: "../../Offer Letter.pdf", allowed: ["pdf"], uploadedBy: user.id, uploadDir: dir });
    expect(row.mime).toBe("application/pdf");
    expect(row.originalName).toBe("Offer Letter.pdf");
    expect(row.sha256).toBe(sha256Hex(PDF));
    expect(row.storageName).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
    expect(readFileSync(resolveStoredPath(dir, row.storageName)).equals(PDF)).toBe(true);
  });

  it("rejects empty, oversized and disallowed files", () => {
    expectDomainError(() => saveUpload(db, { data: Buffer.alloc(0), originalName: "a.pdf", allowed: ["pdf"], uploadedBy: null, uploadDir: dir }), "EMPTY_FILE");
    expectDomainError(() => saveUpload(db, { data: PDF, originalName: "a.pdf", allowed: ["pdf"], uploadedBy: null, uploadDir: dir, maxBytes: 4 }), "FILE_TOO_LARGE");
    expectDomainError(() => saveUpload(db, { data: PNG, originalName: "a.png", allowed: ["pdf"], uploadedBy: null, uploadDir: dir }), "FILE_TYPE");
  });

  it("sanitizes names and blocks path traversal", () => {
    expect(sanitizeFileName("C:\\fakepath\\my<file>.pdf")).toBe("my_file_.pdf");
    expectDomainError(() => resolveStoredPath(dir, "../../etc/passwd"), "BAD_PATH");
  });

  it("allows the uploader, super admins and everyone for the company logo", () => {
    const owner = insertUser(db);
    const other = sessionUserFor(db, insertUser(db));
    const admin = sessionUserFor(db, insertUser(db, { roles: ["super_admin"] }));
    const file = saveUpload(db, { data: PNG, originalName: "logo.png", allowed: ["png"], uploadedBy: owner.id, uploadDir: dir });
    expect(canAccessFile(db, sessionUserFor(db, owner), file)).toBe(true);
    expect(canAccessFile(db, other, file)).toBe(false);
    expect(canAccessFile(db, admin, file)).toBe(true);
    patchSetting(db, "company", { logoFileId: file.id }, null);
    expect(canAccessFile(db, other, file)).toBe(true);
  });
});
