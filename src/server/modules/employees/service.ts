import { and, eq, ne } from "drizzle-orm";
import type { Role } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { ISODate } from "@/lib/dates";
import { fullName, type EmployeeEventType, type EventValues } from "@/lib/hr";
import type { BankInput, ContactInput, JobInput, PersonalInput } from "@/lib/validation/employees";
import type { DbLike } from "@/server/db/client";
import {
  departments, designations, employeeEvents, employees, users, type EmployeeEventRow, type EmployeeRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { assertCanGrantRoles, createUser, findUserByEmail, getUserById } from "@/server/modules/users/service";
import { instantiateChecklist } from "./checklists";
import { nextEmployeeCode } from "./code";
import { getReportingTree } from "./scope";
import { bankView, sealBank, type BankView } from "./sensitive";

export type NewEmployee = PersonalInput & JobInput & BankInput & { employeeCode: string | null };

export type LoginPlan =
  | { mode: "none" }
  | { mode: "create"; roles: Role[]; passwordHash: string }
  | { mode: "link"; userId: number };

export interface NewEmployeeEvent {
  employeeId: number;
  type: EmployeeEventType;
  effectiveDate: ISODate;
  from?: EventValues | null;
  to?: EventValues | null;
  note?: string | null;
  createdBy: number | null;
}

export function recordEmployeeEvent(db: DbLike, event: NewEmployeeEvent): EmployeeEventRow {
  return db
    .insert(employeeEvents)
    .values({ ...event, from: event.from ?? null, to: event.to ?? null, note: event.note ?? null })
    .returning()
    .get();
}

export function requireEmployee(db: DbLike, id: number): EmployeeRow {
  const row = db.select().from(employees).where(eq(employees.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Employee not found.");
  return row;
}

function departmentName(db: DbLike, id: number | null): string | null {
  if (id === null) return null;
  return db.select({ name: departments.name }).from(departments).where(eq(departments.id, id)).get()?.name ?? null;
}

function designationName(db: DbLike, id: number | null): string | null {
  if (id === null) return null;
  return db.select({ name: designations.name }).from(designations).where(eq(designations.id, id)).get()?.name ?? null;
}

function employeeName(db: DbLike, id: number | null): string | null {
  if (id === null) return null;
  return db.select({ name: employees.displayName }).from(employees).where(eq(employees.id, id)).get()?.name ?? null;
}

/** New assignments must point at an active department; keeping the current (even archived) one is fine. */
function assertDepartment(db: DbLike, id: number | null, current: number | null): void {
  if (id === null || id === current) return;
  const row = db.select({ archived: departments.archived }).from(departments).where(eq(departments.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Department not found.", { departmentId: ["Not found"] });
  if (row.archived) throw new DomainError("ARCHIVED", "That department is archived.", { departmentId: ["Archived"] });
}

function assertDesignation(db: DbLike, id: number | null, current: number | null): void {
  if (id === null || id === current) return;
  const row = db.select({ archived: designations.archived }).from(designations).where(eq(designations.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Designation not found.", { designationId: ["Not found"] });
  if (row.archived) throw new DomainError("ARCHIVED", "That designation is archived.", { designationId: ["Archived"] });
}

/** A manager must be a current employee who is not the employee or anyone below them (no reporting loops). */
export function assertValidManager(db: DbLike, employeeId: number | null, managerId: number): void {
  if (employeeId !== null && managerId === employeeId) {
    throw new DomainError("MANAGER_CYCLE", "An employee can't report to themselves.", { reportingManagerId: ["Can't be the same person"] });
  }
  const manager = db.select({ status: employees.status }).from(employees).where(eq(employees.id, managerId)).get();
  if (!manager || manager.status === "exited") {
    throw new DomainError("INVALID_MANAGER", "Choose a current employee as manager.", { reportingManagerId: ["Not a current employee"] });
  }
  if (employeeId !== null && getReportingTree(db, employeeId).includes(managerId)) {
    throw new DomainError("MANAGER_CYCLE", "That person reports to this employee, so they can't be their manager.", {
      reportingManagerId: ["Would create a reporting loop"],
    });
  }
}

function assertWorkEmailFree(db: DbLike, email: string | null, exceptId: number | null): void {
  if (!email) return;
  const clash = db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.workEmail, email), exceptId === null ? undefined : ne(employees.id, exceptId)))
    .get();
  if (clash) throw new DomainError("WORK_EMAIL_TAKEN", "Another employee already uses this work email.", { workEmail: ["Already used"] });
}

function assertLoginEmailFree(db: DbLike, email: string): void {
  if (findUserByEmail(db, email)) {
    throw new DomainError("EMAIL_TAKEN", "A login already exists for this email. Link it instead.", {
      workEmail: ["A login already uses this email; link it instead"],
    });
  }
}

function assertLinkableUser(db: DbLike, userId: number): void {
  if (!getUserById(db, userId)) throw new DomainError("NOT_FOUND", "User not found.", { linkUserId: ["Not found"] });
  const linked = db.select({ id: employees.id }).from(employees).where(eq(employees.userId, userId)).get();
  if (linked) throw new DomainError("USER_ALREADY_LINKED", "That login already belongs to another employee.", { linkUserId: ["Already linked"] });
}

function jobSnapshot(db: DbLike, row: Pick<EmployeeRow, "departmentId" | "designationId" | "reportingManagerId">): EventValues {
  return {
    department: departmentName(db, row.departmentId),
    designation: designationName(db, row.designationId),
    manager: employeeName(db, row.reportingManagerId),
  };
}

function personalColumns(input: PersonalInput) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    displayName: input.displayName ?? fullName(input.firstName, input.lastName),
    workEmail: input.workEmail,
    personalEmail: input.personalEmail,
    phone: input.phone,
    dateOfBirth: input.dateOfBirth,
    gender: input.gender,
    maritalStatus: input.maritalStatus,
    address: input.address,
    emergencyContact: input.emergencyContact,
  };
}

function jobColumns(input: JobInput) {
  return {
    departmentId: input.departmentId,
    designationId: input.designationId,
    reportingManagerId: input.reportingManagerId,
    employmentType: input.employmentType,
    workLocation: input.workLocation,
    dateOfJoining: input.dateOfJoining,
    probationEndDate: input.probationEndDate,
    confirmationDate: input.confirmationDate,
    noticePeriodDays: input.noticePeriodDays,
  };
}

/** Run inside a transaction: it may also create the login and the onboarding checklist. */
export function createEmployee(
  db: DbLike,
  actor: SessionUser,
  input: NewEmployee,
  opts: { login: LoginPlan; onboarding: boolean },
): EmployeeRow {
  assertDepartment(db, input.departmentId, null);
  assertDesignation(db, input.designationId, null);
  if (input.reportingManagerId !== null) assertValidManager(db, null, input.reportingManagerId);
  assertWorkEmailFree(db, input.workEmail, null);
  const employeeCode = input.employeeCode ?? nextEmployeeCode(db);
  if (db.select({ id: employees.id }).from(employees).where(eq(employees.employeeCode, employeeCode)).get()) {
    throw new DomainError("CODE_TAKEN", `Employee code ${employeeCode} is already used.`, { employeeCode: ["Already used"] });
  }
  const personal = personalColumns(input);

  let userId: number | null = null;
  if (opts.login.mode === "create") {
    if (!input.workEmail) {
      throw new DomainError("WORK_EMAIL_REQUIRED", "A work email is required to create a login.", { workEmail: ["Required to create a login"] });
    }
    assertCanGrantRoles(actor, opts.login.roles);
    assertLoginEmailFree(db, input.workEmail);
    userId = createUser(db, {
      email: input.workEmail,
      name: personal.displayName,
      roles: opts.login.roles,
      passwordHash: opts.login.passwordHash,
      mustChangePassword: true,
    }).id;
  } else if (opts.login.mode === "link") {
    assertLinkableUser(db, opts.login.userId);
    userId = opts.login.userId;
  }

  const row = db
    .insert(employees)
    .values({ ...personal, ...jobColumns(input), ...sealBank(input), employeeCode, userId })
    .returning()
    .get();
  recordEmployeeEvent(db, { employeeId: row.id, type: "joined", effectiveDate: row.dateOfJoining, to: jobSnapshot(db, row), createdBy: actor.id });
  if (opts.onboarding) instantiateChecklist(db, row.id, "onboarding");
  return row;
}

/** Job fields; every department, designation or manager change adds an `employee_events` row (spec §5.1). */
export function updateEmployeeJob(
  db: DbLike,
  actorUserId: number,
  employeeId: number,
  input: JobInput,
  effectiveDate: ISODate,
): { before: EmployeeRow; after: EmployeeRow } {
  const before = requireEmployee(db, employeeId);
  if (before.status === "exited") throw new DomainError("EMPLOYEE_EXITED", "Exited employees can't be changed.");
  assertDepartment(db, input.departmentId, before.departmentId);
  assertDesignation(db, input.designationId, before.designationId);
  if (input.reportingManagerId !== null && input.reportingManagerId !== before.reportingManagerId) {
    assertValidManager(db, employeeId, input.reportingManagerId);
  }
  if (input.reportingManagerId === employeeId) assertValidManager(db, employeeId, employeeId);
  const after = db.update(employees).set(jobColumns(input)).where(eq(employees.id, employeeId)).returning().get()!;

  const base = { employeeId, effectiveDate, createdBy: actorUserId };
  if (before.departmentId !== after.departmentId) {
    recordEmployeeEvent(db, {
      ...base, type: "transferred",
      from: { department: departmentName(db, before.departmentId) }, to: { department: departmentName(db, after.departmentId) },
    });
  }
  if (before.designationId !== after.designationId) {
    recordEmployeeEvent(db, {
      ...base, type: "promoted",
      from: { designation: designationName(db, before.designationId) }, to: { designation: designationName(db, after.designationId) },
    });
  }
  if (before.reportingManagerId !== after.reportingManagerId) {
    recordEmployeeEvent(db, {
      ...base, type: "manager_changed",
      from: { manager: employeeName(db, before.reportingManagerId) }, to: { manager: employeeName(db, after.reportingManagerId) },
    });
  }
  if (!before.confirmationDate && after.confirmationDate) {
    recordEmployeeEvent(db, {
      employeeId, type: "confirmed", effectiveDate: after.confirmationDate,
      to: { confirmationDate: after.confirmationDate }, createdBy: actorUserId,
    });
  }
  return { before, after };
}

export function updateEmployeePersonal(db: DbLike, employeeId: number, input: PersonalInput): { before: EmployeeRow; after: EmployeeRow } {
  const before = requireEmployee(db, employeeId);
  assertWorkEmailFree(db, input.workEmail, employeeId);
  const after = db.update(employees).set(personalColumns(input)).where(eq(employees.id, employeeId)).returning().get()!;
  if (after.userId !== null && after.displayName !== before.displayName) {
    db.update(users).set({ name: after.displayName }).where(eq(users.id, after.userId)).run();
  }
  return { before, after };
}

/** Self-service: the contact fields employees may change without approval (spec §5.1). */
export function updateOwnContact(db: DbLike, employeeId: number, input: ContactInput): { before: EmployeeRow; after: EmployeeRow } {
  const before = requireEmployee(db, employeeId);
  const after = db
    .update(employees)
    .set({ personalEmail: input.personalEmail, phone: input.phone, address: input.address, emergencyContact: input.emergencyContact })
    .where(eq(employees.id, employeeId))
    .returning()
    .get()!;
  return { before, after };
}

/** Returns masked views so callers can audit the change without storing secrets. */
export function updateEmployeeBank(db: DbLike, employeeId: number, input: BankInput): { before: BankView; after: BankView } {
  const row = requireEmployee(db, employeeId);
  const updated = db.update(employees).set(sealBank(input)).where(eq(employees.id, employeeId)).returning().get()!;
  return { before: bankView(row, false), after: bankView(updated, false) };
}

export function linkEmployeeUser(db: DbLike, employeeId: number, userId: number): EmployeeRow {
  const employee = requireEmployee(db, employeeId);
  if (employee.userId !== null) throw new DomainError("ALREADY_HAS_LOGIN", "This employee already has a login.");
  assertLinkableUser(db, userId);
  return db.update(employees).set({ userId }).where(eq(employees.id, employeeId)).returning().get()!;
}

export function createEmployeeLogin(
  db: DbLike,
  actor: SessionUser,
  employeeId: number,
  roles: Role[],
  passwordHash: string,
): { employee: EmployeeRow; userId: number } {
  const employee = requireEmployee(db, employeeId);
  if (employee.userId !== null) throw new DomainError("ALREADY_HAS_LOGIN", "This employee already has a login.");
  if (employee.status === "exited") throw new DomainError("EMPLOYEE_EXITED", "Exited employees can't get a login.");
  if (!employee.workEmail) throw new DomainError("WORK_EMAIL_REQUIRED", "Add a work email before creating a login.");
  assertCanGrantRoles(actor, roles);
  assertLoginEmailFree(db, employee.workEmail);
  const user = createUser(db, { email: employee.workEmail, name: employee.displayName, roles, passwordHash, mustChangePassword: true });
  const updated = db.update(employees).set({ userId: user.id }).where(eq(employees.id, employeeId)).returning().get()!;
  return { employee: updated, userId: user.id };
}
