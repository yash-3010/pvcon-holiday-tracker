import "./_env";
import { existsSync } from "node:fs";
import { isLegacyDatabaseFile } from "../src/server/db/client";
import { applyMigrations } from "../src/server/db/migrate";

const file = process.env.DB_FILE ?? "./data/people.db";

// `--existing` runs before a dev server starts (`predev`, `predev:demo`): it brings an existing database up to date
// after a pull, and leaves creating a missing one (with its logins) to the scripts that do that.
if (process.argv.includes("--existing") && !existsSync(file)) {
  console.error(`No database at ${file} yet. Create it with: npm run ${/demo\.db$/.test(file) ? "db:demo" : "db:reset"}`);
  process.exit(1);
}

if (isLegacyDatabaseFile(file)) {
  console.error(
    `Refusing to migrate ${file}: it is a legacy Holiday Tracker database.\n` +
      "Use scripts/migrate-legacy.ts to build a new database from it.",
  );
  process.exit(1);
}

const applied = applyMigrations(file, "./src/server/db/migrations");
console.log(applied === 0 ? `Migrations: ${file} is up to date` : `Migrations applied to ${file}: ${applied} new`);
