import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { employeeSalaries, payrollInputs, payslips, salaryStructures, type EmployeeRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { approveRun, computeRun, createRun, requireRun, revertRun } from "@/server/modules/payroll/runs";
import { effectiveSalary, reviseSalary } from "@/server/modules/payroll/salaries";
import { seedPayrollDefaults } from "@/server/modules/payroll/structures";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser } from "../helpers/fixtures";

let db: DB;
let makerId: number;
let checkerId: number;
let asha: EmployeeRow;
const after = (period: string) => {
  const [y, m] = period.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { today: `${next}-02`, now: new Date(`${next}-02T06:00:00Z`) };
};
const computed = (period: string) => {
  const run = createRun(db, makerId, { period, type: "regular", notes: null }, after(period));
  computeRun(db, makerId, run.id, after(period));
  return requireRun(db, run.id);
};
const approved = (period: string) => approveRun(db, checkerId, computed(period).id, after(period));
const revise = (annualCtc: number, effectiveFrom: string) =>
  reviseSalary(db, makerId, {
    employeeId: asha.id, effectiveFrom, annualCtc, structureId: db.select().from(salaryStructures).get()!.id, overrides: {}, reason: null,
  });
const arrears = (runId: number) =>
  db.select().from(payrollInputs).where(and(eq(payrollInputs.runId, runId), eq(payrollInputs.source, "arrear"))).all().map((i) => [i.label, i.amount]);
const slip = (runId: number) => db.select().from(payslips).where(and(eq(payslips.runId, runId), eq(payslips.employeeId, asha.id))).get()!;

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db, { attendanceMode: "auto" });
  seedDefaultLeaveTypes(db);
  seedPayrollDefaults(db);
  makerId = insertUser(db, { roles: ["payroll_admin"] }).id;
  checkerId = insertUser(db, { roles: ["super_admin"] }).id;
  asha = insertEmployee(db, { firstName: "Asha", dateOfJoining: "2024-03-15" });
  revise(120_000_000, "2026-01-01");
});

describe("arrears", () => {
  it("pays the difference for each approved month a revision reaches back to, once", () => {
    const sep = approved("2026-09");
    const oct = approved("2026-10");
    const raise = revise(150_000_000, "2026-09-01");

    const nov = computed("2026-11");
    expect(arrears(nov.id)).toEqual([
      ["Arrears – Basic (Sept 2026)", 1_250_000], ["Arrears – House rent allowance (Sept 2026)", 500_000],
      ["Arrears – Special allowance (Sept 2026)", 750_000],
      ["Arrears – Basic (Oct 2026)", 1_250_000], ["Arrears – House rent allowance (Oct 2026)", 500_000],
      ["Arrears – Special allowance (Oct 2026)", 750_000],
    ]);
    expect(slip(nov.id).grossEarnings).toBe(12_500_000 + 2 * 2_500_000);

    approveRun(db, checkerId, nov.id, after("2026-11"));
    expect([slip(sep.id).paidBasisSalaryId, slip(oct.id).paidBasisSalaryId]).toEqual([raise.id, raise.id]);
    const dec = computed("2026-12");
    expect(arrears(dec.id)).toEqual([]);
  });

  it("pays only the new difference after a second revision", () => {
    approved("2026-09");
    approved("2026-10");
    revise(150_000_000, "2026-09-01");
    approved("2026-11");
    revise(180_000_000, "2026-10-01");
    const dec = computed("2026-12");
    // October was paid at 15 L (12 L plus arrears), November at 15 L; both now owe the step to 18 L.
    expect(arrears(dec.id).map(([label]) => label)).toEqual([
      "Arrears – Basic (Oct 2026)", "Arrears – House rent allowance (Oct 2026)", "Arrears – Special allowance (Oct 2026)",
      "Arrears – Basic (Nov 2026)", "Arrears – House rent allowance (Nov 2026)", "Arrears – Special allowance (Nov 2026)",
    ]);
    expect(arrears(dec.id)[0]![1]).toBe(1_250_000);
  });

  it("restores the paid basis when the paying run is reverted", () => {
    const sep = approved("2026-09");
    revise(150_000_000, "2026-09-01");
    const oct = approved("2026-10");
    expect(slip(sep.id).paidBasisSalaryId).not.toBeNull();
    revertRun(db, oct.id);
    expect(slip(sep.id).paidBasisSalaryId).toBeNull();
    computeRun(db, makerId, oct.id, after("2026-10"));
    expect(arrears(oct.id)).toHaveLength(3);
  });

  it("keeps a revision payroll has used and adds a correction for its month", () => {
    const first = effectiveSalary(db, asha.id, "2026-09")!;
    const sep = approved("2026-09");
    const corrected = revise(130_000_000, "2026-01-01");
    expect(corrected.id).not.toBe(first.id);
    expect(db.select().from(employeeSalaries).where(eq(employeeSalaries.id, first.id)).get()!.annualCtc).toBe(120_000_000);
    expect(effectiveSalary(db, asha.id, "2026-10")!.id).toBe(corrected.id);
    expect(slip(sep.id).salaryId).toBe(first.id);
    // An unused revision is simply replaced.
    const later = revise(140_000_000, "2026-12-01");
    expect(revise(145_000_000, "2026-12-01").id).toBe(later.id);
  });
});
