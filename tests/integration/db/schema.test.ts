import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, afterEach } from "vitest";
import { isLegacyDatabase, isLegacyDatabaseFile } from "@/server/db/client";
import { userRoles, users } from "@/server/db/schema";
import { createTestDb } from "../../helpers/db";

describe("foundation schema", () => {
  it("creates all foundation tables", () => {
    const db = createTestDb();
    const names = db
      .all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`)
      .map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "users", "user_roles", "password_reset_tokens", "company_settings",
        "audit_logs", "notifications", "job_runs", "files",
      ]),
    );
  });

  it("enforces foreign keys", () => {
    const db = createTestDb();
    expect(() => db.insert(userRoles).values({ userId: 999, role: "employee" }).run()).toThrow(/FOREIGN KEY/);
  });

  it("fills ISO timestamps and defaults", () => {
    const db = createTestDb();
    const user = db
      .insert(users)
      .values({ email: "a@pvcon.in", name: "A", passwordHash: "x" })
      .returning()
      .get();
    expect(user.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(user.status).toBe("active");
    expect(user.mustChangePassword).toBe(true);
    expect(user.sessionVersion).toBe(1);
  });

  it("detects legacy holiday-tracker databases", () => {
    const legacy = new Database(":memory:");
    legacy.exec("create table leave_policy (year integer primary key)");
    expect(isLegacyDatabase(legacy)).toBe(true);
    expect(isLegacyDatabase(new Database(":memory:"))).toBe(false);
  });
});

describe("isLegacyDatabaseFile (read-only probe)", () => {
  let tmpDir: string;

  afterEach(() => {
    // Cleanup temp files
    try {
      // Note: We rely on the OS to clean up tmpdir; vitest may not have fs utilities
      // In practice, the temp dir is cleaned up by the OS after test completion
    } catch {
      // Ignore cleanup errors
    }
  });

  it("returns true for legacy database file without modifying it", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "legacy-db-test-"));
    const legacyFile = join(tmpDir, "legacy.db");

    // Create a legacy database file
    const db = new Database(legacyFile);
    db.exec("create table leave_policy (year integer primary key)");
    db.close();

    // Record sha256 before probe
    const contentBefore = readFileSync(legacyFile);
    const sha256Before = createHash("sha256").update(contentBefore).digest("hex");

    // Probe should return true
    expect(isLegacyDatabaseFile(legacyFile)).toBe(true);

    // Verify file is unchanged
    const contentAfter = readFileSync(legacyFile);
    const sha256After = createHash("sha256").update(contentAfter).digest("hex");
    expect(sha256After).toBe(sha256Before);
    // readonly mode prevents WAL file creation
  });

  it("returns false for missing file path", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "missing-db-test-"));
    const missingFile = join(tmpDir, "does-not-exist.db");
    expect(isLegacyDatabaseFile(missingFile)).toBe(false);
  });

  it("returns false for :memory:", () => {
    expect(isLegacyDatabaseFile(":memory:")).toBe(false);
  });

  it("returns false for new-schema database file", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "newdb-test-"));
    const newFile = join(tmpDir, "new.db");

    // Create a new-schema database (just create a DB without leave_policy table)
    const newDb = new Database(newFile);
    newDb.exec("create table users (id integer primary key)");
    newDb.close();

    // Probe should return false (no leave_policy table)
    expect(isLegacyDatabaseFile(newFile)).toBe(false);
  });
});
