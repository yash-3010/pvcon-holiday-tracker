import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, gte, isNotNull } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  attendanceDays, compOffClaims, employees, expenseClaims, leaveRequests, payrollRuns, payslips, profileChangeRequests, regularizationRequests, timesheets,
} from "@/server/db/schema";
import { buildDemo } from "../../scripts/demo-data";
import { createTestDb } from "../helpers/db";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function demoOn(instant: string) {
  const db = createTestDb();
  const uploadDir = mkdtempSync(path.join(tmpdir(), "pvcon-demo-"));
  dirs.push(uploadDir);
  const summary = await buildDemo(db, { now: new Date(instant), uploadDir, payslipEnv: { uploadDir, appUrl: "http://localhost:3000", signing: null } });
  const count = (rows: unknown[]) => rows.length;
  return {
    db,
    summary,
    pending: {
      leave: count(db.select().from(leaveRequests).where(eq(leaveRequests.status, "pending")).all()),
      corrections: count(db.select().from(regularizationRequests).where(eq(regularizationRequests.status, "pending")).all()),
      compOff: count(db.select().from(compOffClaims).where(eq(compOffClaims.status, "pending")).all()),
      timesheets: count(db.select().from(timesheets).where(eq(timesheets.status, "submitted")).all()),
      claims: count(db.select().from(expenseClaims).where(eq(expenseClaims.status, "submitted")).all()),
      profile: count(db.select().from(profileChangeRequests).where(eq(profileChangeRequests.status, "pending")).all()),
    },
    paidRuns: db.select().from(payrollRuns).where(eq(payrollRuns.status, "paid")).all().map((r) => r.period),
    released: count(db.select().from(payslips).where(isNotNull(payslips.pdfFileId)).all()),
  };
}

describe("demo company", () => {
  it("builds three months of history with work waiting in every inbox", async () => {
    // Thursday 29 October 2026, 10:30 in Pune.
    const demo = await demoOn("2026-10-29T05:00:00Z");
    expect(demo.summary.today).toBe("2026-10-29");
    expect(demo.db.select().from(employees).all()).toHaveLength(13);
    expect(demo.paidRuns).toEqual(["2026-08", "2026-09"]);
    // Twelve people in each paid month: Priya joined in October, Karan left in September.
    expect(demo.released).toBe(24);
    expect(demo.pending).toEqual({ leave: 2, corrections: 1, compOff: 1, timesheets: 3, claims: 1, profile: 1 });

    // Asha forgot to clock in two working days ago; nothing after today is stored.
    const asha = demo.db.select().from(employees).where(eq(employees.firstName, "Asha")).get()!;
    const absent = demo.db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, asha.id), eq(attendanceDays.status, "absent"))).all();
    expect(absent.map((d) => d.date)).toEqual(["2026-10-27"]);
    expect(demo.db.select().from(attendanceDays).where(gte(attendanceDays.date, "2026-10-30")).all()).toEqual([]);
  }, 60_000);

  it("copes with a weekend at the start of a leave year and of a financial year", async () => {
    // Sunday 3 January 2027: the leave year has just begun, so there's no past leave this year, and the scenario's
    // days fall in December, so December's payroll is the one still to run.
    const january = await demoOn("2027-01-03T05:00:00Z");
    expect(january.paidRuns).toEqual(["2026-10", "2026-11"]);
    expect(january.pending).toMatchObject({ corrections: 1, compOff: 1, timesheets: 3, claims: 1, profile: 1 });

    // Sunday 4 April 2027: salaries started in an earlier financial year than the one just begun.
    const april = await demoOn("2027-04-04T05:00:00Z");
    expect(april.paidRuns).toEqual(["2027-01", "2027-02"]);
    expect(april.released).toBe(24);
  }, 120_000);
});
