// Demo payroll data: Hema also runs payroll; everyone gets a salary; a loan and an approved claim.
import "./_env";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/server/db/client";
import { employees, expenseClaims, loans, salaryStructures, userRoles, users } from "../src/server/db/schema";
import { reviseSalary } from "../src/server/modules/payroll/salaries";

const { db } = openDatabase(process.env.DB_FILE ?? "./data/demo.db");
const hema = db.select().from(users).where(eq(users.email, "hema@pvcon.in")).get()!;
if (!db.select().from(userRoles).all().some((r) => r.userId === hema.id && r.role === "payroll_admin")) {
  db.insert(userRoles).values({ userId: hema.id, role: "payroll_admin" }).run();
  db.update(users).set({ sessionVersion: hema.sessionVersion + 1 }).where(eq(users.id, hema.id)).run();
}
const structureId = db.select().from(salaryStructures).get()!.id;
const ctc: Record<string, number> = { Hema: 1_800_000, Ravi: 2_400_000, Asha: 1_200_000, Kiran: 900_000 };
for (const e of db.select().from(employees).all()) {
  const annual = ctc[e.firstName];
  if (!annual) continue;
  reviseSalary(db, hema.id, {
    employeeId: e.id, effectiveFrom: `${e.dateOfJoining.slice(0, 7)}-01` > "2026-04-01" ? `${e.dateOfJoining.slice(0, 7)}-01` : "2026-04-01",
    annualCtc: annual * 100, structureId, overrides: {}, reason: "Demo",
  });
}
const kiran = db.select().from(employees).where(eq(employees.firstName, "Kiran")).get()!;
const asha = db.select().from(employees).where(eq(employees.firstName, "Asha")).get()!;
if (!db.select().from(loans).get()) db.insert(loans).values({ employeeId: kiran.id, principal: 3_000_000, emi: 500_000, startPeriod: "2026-09", note: "Laptop advance", type: "advance" }).run();
if (!db.select().from(expenseClaims).get()) {
  db.insert(expenseClaims).values({
    employeeId: asha.id, category: "travel", claimDate: "2026-09-12", amount: 185_000, description: "Client visit cab", status: "approved",
    approvedAt: "2026-09-14T06:00:00.000Z",
  }).run();
}
console.log("demo payroll data in place");
