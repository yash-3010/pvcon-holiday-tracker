import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "./client";

/**
 * Applies the migrations a database file doesn't have yet and returns how many (0 when it was up to date). Callers
 * refuse a legacy holiday-tracker database first (`isLegacyDatabaseFile`).
 */
export function applyMigrations(file: string, migrationsFolder: string): number {
  const { db, sqlite } = openDatabase(file);
  const recorded = () => {
    const table = sqlite.prepare("select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get();
    return table ? (sqlite.prepare("select count(*) as n from __drizzle_migrations").get() as { n: number }).n : 0;
  };
  try {
    const before = recorded();
    migrate(db, { migrationsFolder });
    return recorded() - before;
  } finally {
    sqlite.close();
  }
}
