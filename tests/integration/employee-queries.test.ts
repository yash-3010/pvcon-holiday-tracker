import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { employees, users } from "@/server/db/schema";
import {
  buildOrgChart, employeeOptions, getEmployeeByUserId, getEmployeeDetail, listDirectory, listEmployeeEvents, listEmployees,
  unlinkedUserOptions, type OrgChartNode,
} from "@/server/modules/employees/queries";
import { createEmployee, recordEmployeeEvent } from "@/server/modules/employees/service";
import { createTestDb } from "../helpers/db";
import { employeeInput, insertDepartment, insertDesignation, insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const none = { login: { mode: "none" as const }, onboarding: false };
const shape = (nodes: OrgChartNode[]): unknown[] => nodes.map((n) => [n.displayName, shape(n.reports)]);

let db: DB;
let hr: SessionUser;
beforeEach(() => {
  db = createTestDb();
  hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"], name: "Hari Rao" }));
});

describe("employee lists and detail", () => {
  it("lists employees with department, designation, manager and login flag", () => {
    const eng = insertDepartment(db, "Engineering");
    const consultant = insertDesignation(db, "Consultant");
    const meera = createEmployee(db, hr, employeeInput({ firstName: "Meera", lastName: "Iyer" }), none);
    const user = insertUser(db);
    createEmployee(db, hr, employeeInput({ departmentId: eng.id, designationId: consultant.id, reportingManagerId: meera.id }), {
      login: { mode: "link", userId: user.id }, onboarding: false,
    });
    expect(listEmployees(db).find((e) => e.displayName === "Asha Rao")).toMatchObject({
      employeeCode: "PV0002", departmentName: "Engineering", designationName: "Consultant", managerName: "Meera Iyer", hasLogin: true, status: "active",
    });
  });

  it("returns a detail view with no encrypted fields, masked unless revealed", () => {
    const row = createEmployee(db, hr, employeeInput({ bankAccount: "123456789012", pan: "ABCDE1234F" }), none);
    const masked = getEmployeeDetail(db, row.id, { revealSensitive: false })!;
    expect(Object.keys(masked).filter((k) => /enc$/i.test(k))).toEqual([]);
    expect(JSON.stringify(masked)).not.toContain("123456789012");
    expect(masked.bank).toMatchObject({ bankAccount: "XXXX9012", pan: "XXXX234F", masked: true });
    expect(getEmployeeDetail(db, row.id, { revealSensitive: true })!.bank.bankAccount).toBe("123456789012");
    expect(getEmployeeDetail(db, 9999, { revealSensitive: false })).toBeNull();
  });

  it("includes the login with roles and only current direct reports", () => {
    const user = insertUser(db, { email: "asha@pvcon.in", roles: ["employee", "manager"] });
    const asha = createEmployee(db, hr, employeeInput(), { login: { mode: "link", userId: user.id }, onboarding: false });
    createEmployee(db, hr, employeeInput({ firstName: "Ravi", lastName: "Menon", reportingManagerId: asha.id }), none);
    insertEmployee(db, { reportingManagerId: asha.id, status: "exited" });
    const detail = getEmployeeDetail(db, asha.id, { revealSensitive: false })!;
    expect(detail.user).toEqual({ id: user.id, email: "asha@pvcon.in", status: "active", roles: ["employee", "manager"] });
    expect(detail.directReports.map((r) => r.displayName)).toEqual(["Ravi Menon"]);
    expect(getEmployeeByUserId(db, user.id)?.id).toBe(asha.id);
  });
});

describe("directory and org chart", () => {
  it("covers current employees only, nested by reporting line", () => {
    const ceo = insertEmployee(db, { firstName: "Meera", lastName: "Iyer" });
    const asha = insertEmployee(db, { firstName: "Asha", lastName: "Rao", reportingManagerId: ceo.id });
    insertEmployee(db, { firstName: "Ravi", lastName: "Menon", reportingManagerId: asha.id });
    insertEmployee(db, { firstName: "Old", lastName: "Timer", reportingManagerId: ceo.id, status: "exited" });
    expect(listDirectory(db).map((d) => d.displayName)).toEqual(["Asha Rao", "Meera Iyer", "Ravi Menon"]);
    expect(shape(buildOrgChart(db))).toEqual([["Meera Iyer", [["Asha Rao", [["Ravi Menon", []]]]]]]);
  });

  it("still shows every member of a stored reporting loop", () => {
    const a = insertEmployee(db, { firstName: "Asha", lastName: "Rao" });
    const b = insertEmployee(db, { firstName: "Ravi", lastName: "Menon", reportingManagerId: a.id });
    db.update(employees).set({ reportingManagerId: b.id }).where(eq(employees.id, a.id)).run();
    const names = JSON.stringify(shape(buildOrgChart(db)));
    expect(names).toContain("Asha Rao");
    expect(names).toContain("Ravi Menon");
  });
});

describe("events and pickers", () => {
  it("lists events newest first with the author's name", () => {
    const row = createEmployee(db, hr, employeeInput(), none);
    recordEmployeeEvent(db, { employeeId: row.id, type: "confirmed", effectiveDate: "2027-04-01", to: { confirmationDate: "2027-04-01" }, createdBy: hr.id });
    expect(listEmployeeEvents(db, row.id).map((e) => [e.type, e.effectiveDate, e.createdByName])).toEqual([
      ["confirmed", "2027-04-01", "Hari Rao"],
      ["joined", "2026-10-01", "Hari Rao"],
    ]);
  });

  it("offers current employees and unlinked active logins", () => {
    const linked = insertUser(db, { name: "Asha Rao", email: "asha@pvcon.in" });
    insertUser(db, { name: "Free User", email: "free@pvcon.in" });
    const disabled = insertUser(db, { name: "Gone User", email: "gone@pvcon.in" });
    db.update(users).set({ status: "disabled" }).where(eq(users.id, disabled.id)).run();
    const asha = createEmployee(db, hr, employeeInput(), { login: { mode: "link", userId: linked.id }, onboarding: false });
    insertEmployee(db, { status: "exited" });
    expect(employeeOptions(db)).toEqual([{ id: asha.id, label: `Asha Rao (${asha.employeeCode})` }]);
    expect(unlinkedUserOptions(db).map((o) => o.label)).toEqual(["Free User <free@pvcon.in>", "Hari Rao <" + hr.email + ">"]);
  });
});
