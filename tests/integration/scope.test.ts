import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { permissionsForRoles, type Role } from "@/lib/auth/permissions";
import type { DB } from "@/server/db/client";
import { employees, users, type EmployeeRow } from "@/server/db/schema";
import {
  canViewEmployee, employeeContextForUser, getReportingTree, isInScope, viewableEmployeeIds,
} from "@/server/modules/employees/scope";
import { activeUserIdsWithPermission, loadSessionUser } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser } from "../helpers/fixtures";

// ceo ← asha ← ravi ← kiran, and ceo ← meera (asha's peer)
let db: DB;
let ceo: EmployeeRow;
let asha: EmployeeRow;
let ravi: EmployeeRow;
let kiran: EmployeeRow;
let meera: EmployeeRow;

const viewer = (employee: EmployeeRow | null, roles: Role[] = ["employee"]) => ({
  permissions: permissionsForRoles(roles),
  employeeId: employee?.id ?? null,
});

beforeEach(() => {
  db = createTestDb();
  ceo = insertEmployee(db);
  asha = insertEmployee(db, { reportingManagerId: ceo.id });
  ravi = insertEmployee(db, { reportingManagerId: asha.id });
  kiran = insertEmployee(db, { reportingManagerId: ravi.id });
  meera = insertEmployee(db, { reportingManagerId: ceo.id });
});

describe("reporting tree", () => {
  it("returns everyone below a manager, direct and indirect", () => {
    expect(getReportingTree(db, ceo.id)).toEqual([asha.id, ravi.id, kiran.id, meera.id]);
    expect(getReportingTree(db, asha.id)).toEqual([ravi.id, kiran.id]);
    expect(getReportingTree(db, kiran.id)).toEqual([]);
  });

  it("terminates on a stored reporting loop and never includes the manager", () => {
    db.update(employees).set({ reportingManagerId: kiran.id }).where(eq(employees.id, asha.id)).run();
    expect(getReportingTree(db, asha.id)).toEqual([ravi.id, kiran.id]);
  });
});

describe("session employee context", () => {
  it("links the user to their employee and detects current direct reports", () => {
    const ashaUser = insertUser(db);
    const kiranUser = insertUser(db);
    const loner = insertUser(db);
    db.update(employees).set({ userId: ashaUser.id }).where(eq(employees.id, asha.id)).run();
    db.update(employees).set({ userId: kiranUser.id }).where(eq(employees.id, kiran.id)).run();

    expect(employeeContextForUser(db, ashaUser.id)).toEqual({ employeeId: asha.id, hasReports: true });
    expect(employeeContextForUser(db, kiranUser.id)).toEqual({ employeeId: kiran.id, hasReports: false });
    expect(employeeContextForUser(db, loner.id)).toEqual({ employeeId: null, hasReports: false });

    db.update(employees).set({ status: "exited" }).where(eq(employees.id, ravi.id)).run();
    expect(employeeContextForUser(db, ashaUser.id).hasReports).toBe(false);
  });

  it("loads team approval permissions into the session of anyone with reports", () => {
    const ashaUser = insertUser(db, { roles: ["employee"] });
    db.update(employees).set({ userId: ashaUser.id }).where(eq(employees.id, asha.id)).run();
    const session = loadSessionUser(db, ashaUser.id, ashaUser.sessionVersion)!;
    expect(session).toMatchObject({ employeeId: asha.id, hasReports: true });
    expect(session.permissions).toContain("leave.approve");
  });
});

describe("scope checks", () => {
  it("lets managers act on their tree only, and never on themselves", () => {
    expect(isInScope(db, viewer(asha), kiran.id)).toBe(true);
    expect(isInScope(db, viewer(asha), meera.id)).toBe(false);
    expect(isInScope(db, viewer(asha), ceo.id)).toBe(false);
    expect(isInScope(db, viewer(asha), asha.id)).toBe(false);
    expect(isInScope(db, viewer(null), kiran.id)).toBe(false);
  });

  it("gives org-wide viewers everyone", () => {
    expect(isInScope(db, viewer(null, ["hr_admin"]), kiran.id)).toBe(true);
    expect(viewableEmployeeIds(db, viewer(null, ["payroll_admin"]))).toBe("all");
  });

  it("lets people view themselves plus their tree", () => {
    expect(canViewEmployee(db, viewer(kiran), kiran.id)).toBe(true);
    expect(canViewEmployee(db, viewer(kiran), ravi.id)).toBe(false);
    expect(viewableEmployeeIds(db, viewer(ravi))).toEqual([ravi.id, kiran.id]);
    expect(viewableEmployeeIds(db, viewer(null))).toEqual([]);
  });
});

describe("activeUserIdsWithPermission", () => {
  it("returns active users whose roles grant the permission", () => {
    const hr = insertUser(db, { roles: ["hr_admin"] });
    const root = insertUser(db, { roles: ["super_admin"] });
    insertUser(db, { roles: ["employee"] });
    const disabledHr = insertUser(db, { roles: ["hr_admin"] });
    db.update(users).set({ status: "disabled" }).where(eq(users.id, disabledHr.id)).run();
    expect(activeUserIdsWithPermission(db, "employee.update")).toEqual([hr.id, root.id]);
  });
});
