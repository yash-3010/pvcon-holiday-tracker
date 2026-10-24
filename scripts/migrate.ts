import "./_env";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { isLegacyDatabaseFile, openDatabase } from "../src/server/db/client";

const file = process.env.DB_FILE ?? "./data/people.db";

if (isLegacyDatabaseFile(file)) {
  console.error(
    `Refusing to migrate ${file}: it is a legacy Holiday Tracker database.\n` +
      "Use scripts/migrate-legacy.ts to build a new database from it.",
  );
  process.exit(1);
}

const { db } = openDatabase(file);
migrate(db, { migrationsFolder: "./src/server/db/migrations" });
console.log(`Migrations applied to ${file}`);
