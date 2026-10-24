import "./_env";
import { openDatabase } from "../src/server/db/client";
import { seedDefaultChecklistTemplates } from "../src/server/modules/employees/checklists";
import { seedDefaultShift } from "../src/server/modules/attendance/shifts";
import { seedDefaultLeaveTypes } from "../src/server/modules/leave/types";
import { seedPayrollDefaults } from "../src/server/modules/payroll/structures";
import { seedTimesheetDefaults } from "../src/server/modules/projects/service";
import { createUser, findUserByEmail, hashPassword } from "../src/server/modules/users/service";

const file = process.env.DB_FILE ?? "./data/people.db";
const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@pvcon.in").toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe@2026";

async function main() {
  const { db } = openDatabase(file);
  const templates = db.transaction((tx) => seedDefaultChecklistTemplates(tx));
  console.log(templates ? `Added ${templates} default checklist template(s).` : "Checklist templates already present.");
  const leaveTypes = db.transaction((tx) => seedDefaultLeaveTypes(tx));
  console.log(leaveTypes ? `Added ${leaveTypes} default leave type(s).` : "Leave types already present.");
  const shift = db.transaction((tx) => seedDefaultShift(tx));
  console.log(`Default shift: ${shift.name} ${shift.startTime}–${shift.endTime}.`);
  db.transaction((tx) => seedTimesheetDefaults(tx));
  console.log("Task categories and the Internal project are in place.");
  db.transaction((tx) => seedPayrollDefaults(tx));
  console.log("Salary components and the Standard structure are in place.");

  if (findUserByEmail(db, email)) {
    console.log(`Super admin ${email} already exists in ${file}; nothing to do.`);
    return;
  }
  const passwordHash = await hashPassword(password);
  db.transaction((tx) =>
    createUser(tx, { email, name: "System Admin", roles: ["super_admin"], passwordHash, mustChangePassword: true }),
  );
  console.log(`Created super admin ${email} in ${file}. Temporary password: ${password} (must change at first sign-in).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
