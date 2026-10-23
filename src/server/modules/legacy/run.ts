import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { migrateLegacy, type MigrationReport } from "./migrate";
import { readLegacy } from "./source";
import { verifyMigration, type Mismatch } from "./verify";

export const MIGRATIONS_FOLDER = "./src/server/db/migrations";

/**
 * Builds a new People database at `to` from the Holiday Tracker database at `from` (spec §8). The old file is opened
 * read-only and never written; an existing `to` is never overwritten. A mismatching verification keeps the new file so
 * it can be inspected.
 */
export function runLegacyMigration({ from, to }: { from: string; to: string }): { report: MigrationReport; mismatches: Mismatch[] } {
  if (!existsSync(from)) throw new DomainError("SOURCE_MISSING", `No database at ${from}.`);
  if (existsSync(to)) throw new DomainError("TARGET_EXISTS", `${to} already exists. Choose a new file or move the old one away.`);

  const legacy = new Database(from, { readonly: true, fileMustExist: true });
  try {
    const source = readLegacy(legacy);
    const { db, sqlite } = openDatabase(to);
    try {
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      const { report, map } = migrateLegacy(source, db);
      return { report, mismatches: verifyMigration(source, db, map) };
    } finally {
      sqlite.close();
    }
  } finally {
    legacy.close();
  }
}
