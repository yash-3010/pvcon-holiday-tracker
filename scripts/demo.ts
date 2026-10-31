// Builds the demo company (scripts/demo-data.ts) in ./data/demo.db, for trying the app locally: npm run db:demo,
// then npm run dev:demo. It only ever writes a database called demo.db, never people.db.
import "./_env";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "../src/server/db/client";
import { payslipEnv } from "../src/server/modules/payroll/env";
import { buildDemo, DEMO_PASSWORD } from "./demo-data";

const file = process.env.DB_FILE ?? "";
const uploadDir = process.env.UPLOAD_DIR ?? "";
if (path.basename(file) !== "demo.db" || path.basename(uploadDir) !== "demo-uploads") {
  console.error("The demo only writes to demo.db and demo-uploads/. Run it with: npm run db:demo");
  process.exit(1);
}

async function main() {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
  rmSync(uploadDir, { recursive: true, force: true });
  mkdirSync(path.dirname(file), { recursive: true });
  const { db, sqlite } = openDatabase(file);
  migrate(db, { migrationsFolder: "./src/server/db/migrations" });
  const { today, logins, scenario } = await buildDemo(db, { now: new Date(), uploadDir, payslipEnv: payslipEnv() });
  sqlite.close();

  const width = Math.max(...logins.map((l) => l.email.length));
  console.log(`\nDemo company ready in ${file} (today is ${today}).\n`);
  console.log(`Every login uses the password ${DEMO_PASSWORD}:`);
  for (const l of logins) console.log(`  ${l.email.padEnd(width)}  ${l.about}`);
  console.log("\nWhat's waiting:");
  for (const line of scenario) console.log(`  - ${line}`);
  console.log("\nStart it with: npm run dev:demo   (then open http://localhost:3000)\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
