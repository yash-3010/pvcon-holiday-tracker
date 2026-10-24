import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { employeeEvents } from "@/server/db/schema";
import { createTestDb } from "../../helpers/db";
import { insertDepartment, insertEmployee } from "../../helpers/employees";
import { insertUser } from "../../helpers/fixtures";

describe("core HR schema", () => {
  it("creates the core HR tables", () => {
    const db = createTestDb();
    const names = db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "departments", "designations", "employees", "employee_documents", "employee_events",
        "checklist_templates", "employee_checklists", "profile_change_requests",
      ]),
    );
  });

  it("keeps employee codes, work emails and linked logins unique", () => {
    const db = createTestDb();
    const user = insertUser(db);
    insertEmployee(db, { employeeCode: "PV0001", workEmail: "a@pvcon.in", userId: user.id });
    expect(() => insertEmployee(db, { employeeCode: "PV0001" })).toThrow(/UNIQUE/);
    expect(() => insertEmployee(db, { workEmail: "a@pvcon.in" })).toThrow(/UNIQUE/);
    expect(() => insertEmployee(db, { userId: user.id })).toThrow(/UNIQUE/);
    expect(() => insertEmployee(db, { workEmail: null })).not.toThrow();
    expect(() => insertEmployee(db, { workEmail: null })).not.toThrow();
  });

  it("rejects references to missing managers and departments", () => {
    const db = createTestDb();
    expect(() => insertEmployee(db, { reportingManagerId: 999 })).toThrow(/FOREIGN KEY/);
    expect(() => insertEmployee(db, { departmentId: 999 })).toThrow(/FOREIGN KEY/);
    const dept = insertDepartment(db, "Engineering");
    expect(insertEmployee(db, { departmentId: dept.id }).departmentId).toBe(dept.id);
  });

  it("defaults status, employment type and notice period", () => {
    const db = createTestDb();
    expect(insertEmployee(db)).toMatchObject({ status: "active", employmentType: "full_time", noticePeriodDays: 30 });
  });

  it("stores event values as JSON", () => {
    const db = createTestDb();
    const e = insertEmployee(db);
    const event = db
      .insert(employeeEvents)
      .values({ employeeId: e.id, type: "joined", effectiveDate: "2026-01-01", to: { department: "Engineering" } })
      .returning()
      .get();
    expect(event.to).toEqual({ department: "Engineering" });
    expect(event.from).toBeNull();
  });
});
