import Database from "better-sqlite3";
import type { RunResult } from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

export type Schema = typeof schema;
/** The root database handle. */
export type DB = BetterSQLite3Database<Schema>;
/** A database or transaction handle. Every service function takes this as its first argument. */
export type DbLike = BaseSQLiteDatabase<"sync", RunResult, Schema>;

export function openDatabase(file: string): { db: DB; sqlite: Database.Database } {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  return { db: drizzle(sqlite, { schema }), sqlite };
}

/** True for the old holiday-tracker database, which must never be migrated in place. */
export function isLegacyDatabase(sqlite: Database.Database): boolean {
  const row = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name = 'leave_policy'")
    .get();
  return row !== undefined;
}

/** Read-only probe: true when `file` exists and is a legacy holiday-tracker database. Never writes to it. */
export function isLegacyDatabaseFile(file: string): boolean {
  if (file === ":memory:" || !existsSync(file)) return false;
  const probe = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return isLegacyDatabase(probe);
  } finally {
    probe.close();
  }
}
