import "./_env";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { isLegacyDatabase, openDatabase } from "../src/server/db/client";

const file = process.env.DB_FILE ?? "./data/people.db";
const { db, sqlite } = openDatabase(file);

if (isLegacyDatabase(sqlite)) {
  console.error(
    `Refusing to migrate ${file}: it is a legacy Holiday Tracker database.\n` +
      "Use scripts/migrate-legacy.ts to build a new database from it.",
  );
  process.exit(1);
}

migrate(db, { migrationsFolder: "./src/server/db/migrations" });
console.log(`Migrations applied to ${file}`);
