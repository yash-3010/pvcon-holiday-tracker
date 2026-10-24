import "./_env";
import { parseArgs } from "node:util";
import { DomainError } from "../src/server/errors";
import { runLegacyMigration } from "../src/server/modules/legacy/run";

const USAGE = "Usage: npx tsx scripts/migrate-legacy.ts --from data/legacy/app.db --to data/people.db";

const { values } = parseArgs({ options: { from: { type: "string" }, to: { type: "string" } } });
if (!values.from || !values.to) {
  console.error(USAGE);
  process.exit(2);
}

try {
  const { report, mismatches } = runLegacyMigration({ from: values.from, to: values.to });
  console.log(`Migrated ${values.from} → ${values.to}`);
  console.log(`  Users:              ${report.users} (${report.superAdmins} super admin(s))`);
  console.log(`  Employees:          ${report.employees} (${report.exitedEmployees} exited)`);
  if (report.adminsWithEmployeeRecord.length) {
    console.log(`  Admins with leave history, given employee records: ${report.adminsWithEmployeeRecord.join(", ")}`);
  }
  console.log(`  Holidays:           ${report.holidays}`);
  console.log(`  Optional picks:     ${report.optionalSelections} (${report.droppedSelections} dropped: admins without leave history)`);
  console.log(`  Leave requests:     ${report.leaveRequests.approved} approved, ${report.leaveRequests.cancelled} cancelled`);
  console.log(`  Ledger entries:     ${report.ledgerEntries} across ${report.years.join(", ") || "no years"}`);
  console.log(`  Attendance days:    ${report.attendanceDays} (auto mode: present unless on leave, a holiday or a weekly off)`);
  if (report.superAdmins === 0) console.warn("  Warning: no super admin was migrated. Run `npm run db:seed` with DB_FILE pointing at the new file.");

  if (mismatches.length) {
    console.error(`\nVerification FAILED: ${mismatches.length} balance(s) differ from the old app.`);
    console.table(mismatches);
    console.error(`${values.to} was kept for inspection. Do not use it in production.`);
    process.exit(1);
  }
  console.log("\nVerification passed: every employee/year balance matches the old app (CL, SL, unpaid, optional).");
} catch (err) {
  if (err instanceof DomainError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
