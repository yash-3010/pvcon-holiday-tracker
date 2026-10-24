import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SalaryInput } from "@/lib/validation/payroll";
import type { DB } from "@/server/db/client";
import { employeeEvents, salaryStructures, type EmployeeRow } from "@/server/db/schema";
import { effectiveSalary, reviseSalary, salaryHistory, salaryPreview } from "@/server/modules/payroll/salaries";
import { seedPayrollDefaults, setStructureArchived } from "@/server/modules/payroll/structures";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser } from "../helpers/fixtures";

let db: DB;
let asha: EmployeeRow;
let hrId: number;
let standardId: number;
const salary = (overrides: Partial<SalaryInput> = {}): SalaryInput => ({
  employeeId: asha.id, effectiveFrom: "2026-04-01", annualCtc: 120_000_000, structureId: standardId, overrides: {}, reason: null, ...overrides,
});

beforeEach(() => {
  db = createTestDb();
  seedPayrollDefaults(db);
  standardId = db.select().from(salaryStructures).get()!.id;
  hrId = insertUser(db, { roles: ["hr_admin"] }).id;
  asha = insertEmployee(db, { dateOfJoining: "2025-06-15" });
});

describe("salary revisions", () => {
  it("applies from the effective month and records the revision", () => {
    reviseSalary(db, hrId, salary({ effectiveFrom: "2025-06-01", annualCtc: 90_000_000, reason: "Joining" }));
    reviseSalary(db, hrId, salary({ reason: "Annual increment" }));
    expect(effectiveSalary(db, asha.id, "2025-05")).toBeUndefined();
    expect(effectiveSalary(db, asha.id, "2026-03")).toMatchObject({ annualCtc: 90_000_000 });
    expect(effectiveSalary(db, asha.id, "2026-04")).toMatchObject({ annualCtc: 120_000_000, approvedBy: hrId });
    expect(salaryHistory(db, asha.id).map((s) => s.effectiveFrom)).toEqual(["2026-04-01", "2025-06-01"]);
    const events = db.select().from(employeeEvents).where(eq(employeeEvents.type, "salary_revised")).all();
    expect(events.map((e) => [e.effectiveDate, e.from, e.to])).toEqual([
      ["2025-06-01", null, { annualCtc: 90_000_000 }],
      ["2026-04-01", { annualCtc: 90_000_000 }, { annualCtc: 120_000_000 }],
    ]);
  });

  it("replaces a revision for the same month", () => {
    reviseSalary(db, hrId, salary());
    reviseSalary(db, hrId, salary({ annualCtc: 130_000_000 }));
    expect(salaryHistory(db, asha.id).map((s) => s.annualCtc)).toEqual([130_000_000]);
  });

  it("refuses dates before joining, archived structures, unknown overrides and broken formulas", () => {
    expectDomainError(() => reviseSalary(db, hrId, salary({ effectiveFrom: "2025-05-01" })), "BEFORE_JOINING");
    expectDomainError(() => reviseSalary(db, hrId, salary({ overrides: { PF: 100 } })), "UNKNOWN_COMPONENT");
    expectDomainError(() => reviseSalary(db, hrId, salary({ overrides: { BASIC: "HRA_RATE * 2" } })), "INVALID_SALARY");
    setStructureArchived(db, standardId, true);
    expectDomainError(() => reviseSalary(db, hrId, salary()), "ARCHIVED");
    const gone = insertEmployee(db, { status: "exited" });
    expectDomainError(() => reviseSalary(db, hrId, salary({ employeeId: gone.id })), "NOT_CURRENT");
  });

  it("previews the monthly and annual breakdown", () => {
    const preview = salaryPreview(db, { structureId: standardId, annualCtc: 120_000_000, overrides: { BASIC: 6_000_000 } });
    expect(preview.lines.map((l) => [l.code, l.monthly, l.annual])).toEqual([
      ["BASIC", 6_000_000, 72_000_000], ["HRA", 2_400_000, 28_800_000], ["SPECIAL", 1_600_000, 19_200_000],
    ]);
    expect(preview).toMatchObject({ grossMonthly: 10_000_000, netMonthly: 10_000_000, errors: [] });
  });
});
