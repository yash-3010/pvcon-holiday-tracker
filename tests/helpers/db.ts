import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase, type DB } from "@/server/db/client";

/** Fresh in-memory database with all migrations applied. */
export function createTestDb(): DB {
  const { db } = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "src/server/db/migrations" });
  return db;
}
