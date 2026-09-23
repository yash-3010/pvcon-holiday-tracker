import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { isLegacyDatabase } from "@/server/db/client";
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
