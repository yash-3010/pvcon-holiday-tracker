import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { JobInput } from "@/lib/validation/employees";
import type { DB } from "@/server/db/client";
import { departments, employeeEvents, employees, type EmployeeRow } from "@/server/db/schema";
import { listEmployeeChecklists, seedDefaultChecklistTemplates } from "@/server/modules/employees/checklists";
import { openBank } from "@/server/modules/employees/sensitive";
import {
  createEmployee, createEmployeeLogin, linkEmployeeUser, updateEmployeeBank, updateEmployeeJob, updateEmployeePersonal,
  updateOwnContact,
} from "@/server/modules/employees/service";
import { getUserById, getUserRoles } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { employeeInput, insertDepartment, insertDesignation, insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const none = { login: { mode: "none" as const }, onboarding: false };
const createLogin = (roles: Role[], passwordHash = "x") => ({ login: { mode: "create" as const, roles, passwordHash }, onboarding: false });
const jobOf = (row: EmployeeRow, patch: Partial<JobInput> = {}): JobInput => ({
  departmentId: row.departmentId, designationId: row.designationId, reportingManagerId: row.reportingManagerId,
  employmentType: row.employmentType, workLocation: row.workLocation, dateOfJoining: row.dateOfJoining,
  probationEndDate: row.probationEndDate, confirmationDate: row.confirmationDate, noticePeriodDays: row.noticePeriodDays,
  ...patch,
});

let db: DB;
let hr: SessionUser;
const eventsOf = (employeeId: number) =>
  db.select().from(employeeEvents).where(eq(employeeEvents.employeeId, employeeId)).all().map((e) => ({ type: e.type, from: e.from, to: e.to }));

beforeEach(() => {
  db = createTestDb();
  hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
});

describe("createEmployee", () => {
  it("assigns the next code, a display name and a joined event with readable job values", () => {
    const eng = insertDepartment(db, "Engineering");
    const consultant = insertDesignation(db, "Consultant");
    const boss = insertEmployee(db, { firstName: "Meera", lastName: "Iyer" });
    const row = createEmployee(db, hr, employeeInput({ departmentId: eng.id, designationId: consultant.id, reportingManagerId: boss.id }), none);
    expect(row).toMatchObject({ employeeCode: "PV0001", displayName: "Asha Rao", status: "active", userId: null });
    expect(eventsOf(row.id)).toEqual([
      { type: "joined", from: null, to: { department: "Engineering", designation: "Consultant", manager: "Meera Iyer" } },
    ]);
  });

  it("encrypts bank and ID numbers at rest", () => {
    const row = createEmployee(db, hr, employeeInput({ bankAccount: "123456789012", pan: "ABCDE1234F" }), none);
    expect(row.bankAccountEnc).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain("123456789012");
    expect(openBank(row)).toMatchObject({ bankAccount: "123456789012", pan: "ABCDE1234F" });
  });

  it("instantiates the onboarding checklist only when asked", () => {
    seedDefaultChecklistTemplates(db);
    const withList = createEmployee(db, hr, employeeInput(), { ...none, onboarding: true });
    const without = createEmployee(db, hr, employeeInput({ firstName: "Ravi" }), none);
    expect(listEmployeeChecklists(db, withList.id).map((c) => c.kind)).toEqual(["onboarding"]);
    expect(listEmployeeChecklists(db, without.id)).toEqual([]);
  });

  it("rejects archived departments, exited managers, reused work emails and reused codes", () => {
    const old = insertDepartment(db, "Old", { archived: true });
    const leaver = insertEmployee(db, { status: "exited" });
    createEmployee(db, hr, employeeInput({ workEmail: "asha@pvcon.in", employeeCode: "PV0100" }), none);
    expectDomainError(() => createEmployee(db, hr, employeeInput({ departmentId: old.id }), none), "ARCHIVED");
    expectDomainError(() => createEmployee(db, hr, employeeInput({ reportingManagerId: leaver.id }), none), "INVALID_MANAGER");
    expectDomainError(() => createEmployee(db, hr, employeeInput({ workEmail: "asha@pvcon.in" }), none), "WORK_EMAIL_TAKEN");
    expectDomainError(() => createEmployee(db, hr, employeeInput({ employeeCode: "PV0100" }), none), "CODE_TAKEN");
  });

  it("creates a login that must change its temporary password", () => {
    const passwordHash = bcrypt.hashSync("Temp-Passw0rd", 4);
    const row = createEmployee(db, hr, employeeInput({ workEmail: "asha@pvcon.in" }), createLogin(["employee", "manager"], passwordHash));
    const user = getUserById(db, row.userId!)!;
    expect(user).toMatchObject({ email: "asha@pvcon.in", name: "Asha Rao", mustChangePassword: true, passwordHash });
    expect(getUserRoles(db, user.id)).toEqual(["employee", "manager"]);
  });

  it("guards login creation: work email required, no privileged roles from HR, no duplicate logins", () => {
    expectDomainError(() => createEmployee(db, hr, employeeInput(), createLogin(["employee"])), "WORK_EMAIL_REQUIRED");
    expectDomainError(() => createEmployee(db, hr, employeeInput({ workEmail: "a@pvcon.in" }), createLogin(["hr_admin"])), "FORBIDDEN_ROLE");
    insertUser(db, { email: "taken@pvcon.in" });
    expectDomainError(() => createEmployee(db, hr, employeeInput({ workEmail: "taken@pvcon.in" }), createLogin(["employee"])), "EMAIL_TAKEN");
    expect(db.select().from(employees).all()).toHaveLength(0);
  });

  it("links an existing login at most once", () => {
    const user = insertUser(db, { email: "admin@pvcon.in" });
    const link = { login: { mode: "link" as const, userId: user.id }, onboarding: false };
    expect(createEmployee(db, hr, employeeInput(), link).userId).toBe(user.id);
    expectDomainError(() => createEmployee(db, hr, employeeInput({ firstName: "Ravi" }), link), "USER_ALREADY_LINKED");
  });
});

describe("updateEmployeeJob", () => {
  it("records department, designation, manager and confirmation events", () => {
    const eng = insertDepartment(db, "Engineering");
    const sales = insertDepartment(db, "Sales");
    const analyst = insertDesignation(db, "Analyst");
    const consultant = insertDesignation(db, "Consultant");
    const meera = insertEmployee(db, { firstName: "Meera", lastName: "Iyer" });
    const row = createEmployee(db, hr, employeeInput({ departmentId: eng.id, designationId: analyst.id }), none);
    const job = jobOf(row, {
      departmentId: sales.id, designationId: consultant.id, reportingManagerId: meera.id,
      workLocation: "Pune", confirmationDate: "2027-04-01", noticePeriodDays: 60,
    });
    expect(updateEmployeeJob(db, hr.id, row.id, job, "2026-11-01").after).toMatchObject({ departmentId: sales.id, workLocation: "Pune", noticePeriodDays: 60 });
    expect(eventsOf(row.id).slice(1)).toEqual([
      { type: "transferred", from: { department: "Engineering" }, to: { department: "Sales" } },
      { type: "promoted", from: { designation: "Analyst" }, to: { designation: "Consultant" } },
      { type: "manager_changed", from: { manager: null }, to: { manager: "Meera Iyer" } },
      { type: "confirmed", from: null, to: { confirmationDate: "2027-04-01" } },
    ]);
  });

  it("refuses reporting loops and self-management", () => {
    const asha = createEmployee(db, hr, employeeInput(), none);
    const ravi = createEmployee(db, hr, employeeInput({ firstName: "Ravi", reportingManagerId: asha.id }), none);
    const kiran = createEmployee(db, hr, employeeInput({ firstName: "Kiran", reportingManagerId: ravi.id }), none);
    expectDomainError(() => updateEmployeeJob(db, hr.id, asha.id, jobOf(asha, { reportingManagerId: kiran.id }), "2026-11-01"), "MANAGER_CYCLE");
    expectDomainError(() => updateEmployeeJob(db, hr.id, asha.id, jobOf(asha, { reportingManagerId: asha.id }), "2026-11-01"), "MANAGER_CYCLE");
  });

  it("keeps an unchanged archived department, but refuses to change exited employees", () => {
    const old = insertDepartment(db, "Old");
    const row = createEmployee(db, hr, employeeInput({ departmentId: old.id }), none);
    db.update(departments).set({ archived: true }).where(eq(departments.id, old.id)).run();
    expect(updateEmployeeJob(db, hr.id, row.id, jobOf(row, { workLocation: "Remote" }), "2026-11-01").after.workLocation).toBe("Remote");
    db.update(employees).set({ status: "exited" }).where(eq(employees.id, row.id)).run();
    expectDomainError(() => updateEmployeeJob(db, hr.id, row.id, jobOf(row), "2026-11-01"), "EMPLOYEE_EXITED");
  });
});

describe("personal, contact and bank updates", () => {
  it("renames the linked login along with the employee", () => {
    const user = insertUser(db);
    const row = createEmployee(db, hr, employeeInput(), { login: { mode: "link", userId: user.id }, onboarding: false });
    updateEmployeePersonal(db, row.id, employeeInput({ lastName: "Kulkarni" }));
    expect(getUserById(db, user.id)!.name).toBe("Asha Kulkarni");
  });

  it("refuses a work email another employee uses", () => {
    createEmployee(db, hr, employeeInput({ workEmail: "asha@pvcon.in" }), none);
    const ravi = createEmployee(db, hr, employeeInput({ firstName: "Ravi" }), none);
    expectDomainError(() => updateEmployeePersonal(db, ravi.id, employeeInput({ firstName: "Ravi", workEmail: "asha@pvcon.in" })), "WORK_EMAIL_TAKEN");
  });

  it("changes only contact fields for self-service", () => {
    const row = createEmployee(db, hr, employeeInput({ phone: "+91 90000 00000" }), none);
    const { after } = updateOwnContact(db, row.id, {
      personalEmail: "asha@example.com", phone: "+91 98450 12345", address: null,
      emergencyContact: { name: "Ravi Rao", relation: "Brother", phone: "+91 90000 11111" },
    });
    expect(after).toMatchObject({ phone: "+91 98450 12345", personalEmail: "asha@example.com", firstName: "Asha" });
  });

  it("returns masked before/after values for bank changes", () => {
    const row = createEmployee(db, hr, employeeInput({ bankAccount: "111122223333" }), none);
    const { before, after } = updateEmployeeBank(db, row.id, {
      bankName: "HDFC Bank", bankAccount: "444455556666", bankIfsc: "HDFC0001234", pan: null, aadhaar: null, passport: null,
    });
    expect(before.bankAccount).toBe("XXXX3333");
    expect(after).toMatchObject({ bankAccount: "XXXX6666", bankName: "HDFC Bank", masked: true });
  });
});

describe("logins for existing employees", () => {
  it("creates or links a login once, and needs a work email to create one", () => {
    const withEmail = createEmployee(db, hr, employeeInput({ workEmail: "asha@pvcon.in" }), none);
    const { employee, userId } = createEmployeeLogin(db, hr, withEmail.id, ["employee"], "x");
    expect(employee.userId).toBe(userId);
    expectDomainError(() => createEmployeeLogin(db, hr, withEmail.id, ["employee"], "x"), "ALREADY_HAS_LOGIN");

    const noEmail = createEmployee(db, hr, employeeInput({ firstName: "Ravi" }), none);
    expectDomainError(() => createEmployeeLogin(db, hr, noEmail.id, ["employee"], "x"), "WORK_EMAIL_REQUIRED");
    const user = insertUser(db);
    expect(linkEmployeeUser(db, noEmail.id, user.id).userId).toBe(user.id);
    expectDomainError(() => linkEmployeeUser(db, noEmail.id, user.id), "ALREADY_HAS_LOGIN");
  });
});
