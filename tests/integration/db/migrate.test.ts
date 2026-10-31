import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyMigrations } from "@/server/db/migrate";

const MIGRATIONS = "src/server/db/migrations";
const journal = JSON.parse(readFileSync(path.join(MIGRATIONS, "meta/_journal.json"), "utf8")) as { entries: unknown[] };

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("applyMigrations", () => {
  it("applies what a database file lacks and says how many, so a dev server can bring one up to date", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pvcon-migrate-"));
    dirs.push(dir);
    const file = path.join(dir, "people.db");
    expect(applyMigrations(file, MIGRATIONS)).toBe(journal.entries.length);
    expect(applyMigrations(file, MIGRATIONS)).toBe(0);
  });
});
