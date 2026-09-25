import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { employees } from "@/server/db/schema";
import { departmentOptions, designationOptions, listDepartments, listDesignations } from "@/server/modules/org/queries";
import {
  createDepartment, createDesignation, setDepartmentArchived, setDesignationArchived, updateDepartment, updateDesignation,
} from "@/server/modules/org/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError } from "../helpers/fixtures";

type DeptExtra = Partial<{ code: string | null; parentId: number | null; headEmployeeId: number | null }>;
const dept = (name: string, extra: DeptExtra = {}) => ({ name, code: null, parentId: null, headEmployeeId: null, ...extra });

let db: DB;
beforeEach(() => {
  db = createTestDb();
});

describe("departments", () => {
  it("creates departments with unique names (any case) and codes", () => {
    expect(createDepartment(db, dept("Engineering", { code: "ENG" }))).toMatchObject({ name: "Engineering", code: "ENG", archived: false });
    expectDomainError(() => createDepartment(db, dept("engineering")), "DUPLICATE_NAME");
    expectDomainError(() => createDepartment(db, dept("Platform", { code: "ENG" })), "DUPLICATE_CODE");
  });

  it("refuses parent loops, including a department under itself", () => {
    const eng = createDepartment(db, dept("Engineering"));
    const platform = createDepartment(db, dept("Platform", { parentId: eng.id }));
    expectDomainError(() => updateDepartment(db, eng.id, dept("Engineering", { parentId: platform.id })), "DEPARTMENT_CYCLE");
    expectDomainError(() => updateDepartment(db, eng.id, dept("Engineering", { parentId: eng.id })), "DEPARTMENT_CYCLE");
    expect(updateDepartment(db, platform.id, dept("Platform Eng", { parentId: eng.id })).after.name).toBe("Platform Eng");
  });

  it("requires an active parent and a current employee as head", () => {
    const old = createDepartment(db, dept("Old"));
    setDepartmentArchived(db, old.id, true);
    expectDomainError(() => createDepartment(db, dept("New", { parentId: old.id })), "ARCHIVED");
    const leaver = insertEmployee(db, { status: "exited" });
    expectDomainError(() => createDepartment(db, dept("Sales", { headEmployeeId: leaver.id })), "INVALID_HEAD");
    const head = insertEmployee(db);
    expect(createDepartment(db, dept("Sales", { headEmployeeId: head.id })).headEmployeeId).toBe(head.id);
  });

  it("archives only departments without current employees or active sub-departments", () => {
    const eng = createDepartment(db, dept("Engineering"));
    const member = insertEmployee(db, { departmentId: eng.id });
    expectDomainError(() => setDepartmentArchived(db, eng.id, true), "DEPARTMENT_IN_USE");
    db.update(employees).set({ status: "exited" }).where(eq(employees.id, member.id)).run();
    expect(setDepartmentArchived(db, eng.id, true).archived).toBe(true);
    expect(setDepartmentArchived(db, eng.id, false).archived).toBe(false);

    const parent = createDepartment(db, dept("Parent"));
    createDepartment(db, dept("Child", { parentId: parent.id }));
    expectDomainError(() => setDepartmentArchived(db, parent.id, true), "DEPARTMENT_HAS_CHILDREN");
  });

  it("lists departments with parent, head and current head-count; options skip archived ones", () => {
    const head = insertEmployee(db, { firstName: "Asha", lastName: "Rao", displayName: "Asha Rao" });
    const eng = createDepartment(db, dept("Engineering", { headEmployeeId: head.id }));
    createDepartment(db, dept("Platform", { parentId: eng.id }));
    const old = createDepartment(db, dept("Old"));
    setDepartmentArchived(db, old.id, true);
    insertEmployee(db, { departmentId: eng.id });
    insertEmployee(db, { departmentId: eng.id, status: "exited" });

    const rows = listDepartments(db);
    expect(rows.find((r) => r.name === "Engineering")).toMatchObject({ headName: "Asha Rao", employeeCount: 1, parentName: null });
    expect(rows.find((r) => r.name === "Platform")).toMatchObject({ parentName: "Engineering", employeeCount: 0 });
    expect(departmentOptions(db).map((o) => o.label)).toEqual(["Engineering", "Platform"]);
  });
});

describe("designations", () => {
  it("creates and renames designations with unique names", () => {
    const consultant = createDesignation(db, { name: "Consultant", level: 2 });
    createDesignation(db, { name: "Manager", level: 4 });
    expectDomainError(() => createDesignation(db, { name: "consultant", level: null }), "DUPLICATE_NAME");
    expectDomainError(() => updateDesignation(db, consultant.id, { name: "Manager", level: 2 }), "DUPLICATE_NAME");
    expect(updateDesignation(db, consultant.id, { name: "Senior Consultant", level: 3 }).after).toMatchObject({ name: "Senior Consultant", level: 3 });
  });

  it("refuses to archive a designation current employees hold, and hides archived ones from options", () => {
    const consultant = createDesignation(db, { name: "Consultant", level: null });
    const analyst = createDesignation(db, { name: "Analyst", level: null });
    insertEmployee(db, { designationId: consultant.id });
    expectDomainError(() => setDesignationArchived(db, consultant.id, true), "DESIGNATION_IN_USE");
    setDesignationArchived(db, analyst.id, true);
    expect(designationOptions(db).map((o) => o.label)).toEqual(["Consultant"]);
    expect(listDesignations(db).find((d) => d.name === "Consultant")?.employeeCount).toBe(1);
  });
});
