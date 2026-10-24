import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Role } from "@/lib/auth/permissions";
import type {
  Address, EmergencyContact, EmployeeEventType, EmployeeStatus, EmploymentType, EventValues, Gender, MaritalStatus, SelectOption,
} from "@/lib/hr";
import type { DbLike } from "@/server/db/client";
import { departments, designations, employeeEvents, employees, users, type EmployeeRow } from "@/server/db/schema";
import { getUserRoles } from "@/server/modules/users/service";
import { bankView, type BankView } from "./sensitive";

const CURRENT = ["active", "on_notice"] as const;

export interface EmployeeListItem {
  id: number;
  employeeCode: string;
  displayName: string;
  workEmail: string | null;
  departmentId: number | null;
  departmentName: string | null;
  designationName: string | null;
  managerName: string | null;
  status: EmployeeStatus;
  dateOfJoining: string;
  hasLogin: boolean;
}

export function listEmployees(db: DbLike): EmployeeListItem[] {
  const manager = alias(employees, "manager");
  return db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      displayName: employees.displayName,
      workEmail: employees.workEmail,
      departmentId: employees.departmentId,
      departmentName: departments.name,
      designationName: designations.name,
      managerName: manager.displayName,
      status: employees.status,
      dateOfJoining: employees.dateOfJoining,
      userId: employees.userId,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(manager, eq(manager.id, employees.reportingManagerId))
    .orderBy(asc(employees.displayName))
    .all()
    .map((row) => ({
      id: row.id,
      employeeCode: row.employeeCode,
      displayName: row.displayName,
      workEmail: row.workEmail,
      departmentId: row.departmentId,
      departmentName: row.departmentName,
      designationName: row.designationName,
      managerName: row.managerName,
      status: row.status,
      dateOfJoining: row.dateOfJoining,
      hasLogin: row.userId !== null,
    }));
}

export interface EmployeeDetail {
  id: number;
  employeeCode: string;
  firstName: string;
  lastName: string;
  displayName: string;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  maritalStatus: MaritalStatus | null;
  address: Address | null;
  emergencyContact: EmergencyContact | null;
  departmentId: number | null;
  departmentName: string | null;
  designationId: number | null;
  designationName: string | null;
  reportingManagerId: number | null;
  managerName: string | null;
  managerCode: string | null;
  employmentType: EmploymentType;
  workLocation: string | null;
  dateOfJoining: string;
  probationEndDate: string | null;
  confirmationDate: string | null;
  noticePeriodDays: number;
  status: EmployeeStatus;
  resignationDate: string | null;
  lastWorkingDate: string | null;
  exitReason: string | null;
  bank: BankView;
  user: { id: number; email: string; status: "active" | "disabled"; roles: Role[] } | null;
  photoFileId: number | null;
  directReports: { id: number; displayName: string; employeeCode: string }[];
}

/** Whitelists fields explicitly so encrypted columns can never reach a client component. */
export function getEmployeeDetail(db: DbLike, id: number, opts: { revealSensitive: boolean }): EmployeeDetail | null {
  const manager = alias(employees, "manager");
  const row = db
    .select({
      employee: employees,
      departmentName: departments.name,
      designationName: designations.name,
      managerName: manager.displayName,
      managerCode: manager.employeeCode,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(manager, eq(manager.id, employees.reportingManagerId))
    .where(eq(employees.id, id))
    .get();
  if (!row) return null;
  const e = row.employee;
  const login =
    e.userId === null
      ? undefined
      : db.select({ id: users.id, email: users.email, status: users.status }).from(users).where(eq(users.id, e.userId)).get();
  const directReports = db
    .select({ id: employees.id, displayName: employees.displayName, employeeCode: employees.employeeCode })
    .from(employees)
    .where(and(eq(employees.reportingManagerId, e.id), inArray(employees.status, [...CURRENT])))
    .orderBy(asc(employees.displayName))
    .all();
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
    displayName: e.displayName,
    workEmail: e.workEmail,
    personalEmail: e.personalEmail,
    phone: e.phone,
    dateOfBirth: e.dateOfBirth,
    gender: e.gender,
    maritalStatus: e.maritalStatus,
    address: e.address,
    emergencyContact: e.emergencyContact,
    departmentId: e.departmentId,
    departmentName: row.departmentName,
    designationId: e.designationId,
    designationName: row.designationName,
    reportingManagerId: e.reportingManagerId,
    managerName: row.managerName,
    managerCode: row.managerCode,
    employmentType: e.employmentType,
    workLocation: e.workLocation,
    dateOfJoining: e.dateOfJoining,
    probationEndDate: e.probationEndDate,
    confirmationDate: e.confirmationDate,
    noticePeriodDays: e.noticePeriodDays,
    status: e.status,
    resignationDate: e.resignationDate,
    lastWorkingDate: e.lastWorkingDate,
    exitReason: e.exitReason,
    bank: bankView(e, opts.revealSensitive),
    user: login ? { ...login, roles: getUserRoles(db, login.id) } : null,
    photoFileId: e.photoFileId,
    directReports,
  };
}

export interface DirectoryEntry {
  id: number;
  employeeCode: string;
  displayName: string;
  designationName: string | null;
  departmentId: number | null;
  departmentName: string | null;
  workEmail: string | null;
  phone: string | null;
  managerName: string | null;
  status: EmployeeStatus;
  photoFileId: number | null;
}

/** The employee's photo for the account menu, or null. */
export function employeePhotoFileId(db: DbLike, employeeId: number): number | null {
  return db.select({ id: employees.photoFileId }).from(employees).where(eq(employees.id, employeeId)).get()?.id ?? null;
}

export function listDirectory(db: DbLike): DirectoryEntry[] {
  const manager = alias(employees, "manager");
  return db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      displayName: employees.displayName,
      designationName: designations.name,
      departmentId: employees.departmentId,
      departmentName: departments.name,
      workEmail: employees.workEmail,
      phone: employees.phone,
      managerName: manager.displayName,
      status: employees.status,
      photoFileId: employees.photoFileId,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(manager, eq(manager.id, employees.reportingManagerId))
    .where(inArray(employees.status, [...CURRENT]))
    .orderBy(asc(employees.displayName))
    .all();
}

export interface OrgChartNode {
  id: number;
  displayName: string;
  employeeCode: string;
  designationName: string | null;
  departmentName: string | null;
  reports: OrgChartNode[];
}

/** Current employees nested by reporting line. Members of a stored reporting loop are surfaced at the top level. */
export function buildOrgChart(db: DbLike): OrgChartNode[] {
  const rows = db
    .select({
      id: employees.id,
      displayName: employees.displayName,
      employeeCode: employees.employeeCode,
      designationName: designations.name,
      departmentName: departments.name,
      managerId: employees.reportingManagerId,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(inArray(employees.status, [...CURRENT]))
    .orderBy(asc(employees.displayName))
    .all();
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<number, number[]>();
  const roots: number[] = [];
  for (const r of rows) {
    if (r.managerId !== null && r.managerId !== r.id && ids.has(r.managerId)) {
      children.set(r.managerId, [...(children.get(r.managerId) ?? []), r.id]);
    } else {
      roots.push(r.id);
    }
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const visited = new Set<number>();
  const build = (id: number): OrgChartNode => {
    visited.add(id);
    const r = byId.get(id)!;
    const reports = (children.get(id) ?? []).filter((child) => !visited.has(child)).map(build);
    return {
      id: r.id,
      displayName: r.displayName,
      employeeCode: r.employeeCode,
      designationName: r.designationName,
      departmentName: r.departmentName,
      reports,
    };
  };
  const tree = roots.map(build);
  for (const r of rows) if (!visited.has(r.id)) tree.push(build(r.id));
  return tree;
}

export interface EmployeeEventView {
  id: number;
  type: EmployeeEventType;
  effectiveDate: string;
  from: EventValues | null;
  to: EventValues | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

export function listEmployeeEvents(db: DbLike, employeeId: number): EmployeeEventView[] {
  return db
    .select({
      id: employeeEvents.id,
      type: employeeEvents.type,
      effectiveDate: employeeEvents.effectiveDate,
      from: employeeEvents.from,
      to: employeeEvents.to,
      note: employeeEvents.note,
      createdByName: users.name,
      createdAt: employeeEvents.createdAt,
    })
    .from(employeeEvents)
    .leftJoin(users, eq(users.id, employeeEvents.createdBy))
    .where(eq(employeeEvents.employeeId, employeeId))
    .orderBy(desc(employeeEvents.effectiveDate), desc(employeeEvents.id))
    .all();
}

export function employeeOptions(db: DbLike): SelectOption[] {
  return db
    .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode })
    .from(employees)
    .where(inArray(employees.status, [...CURRENT]))
    .orderBy(asc(employees.displayName))
    .all()
    .map((row) => ({ id: row.id, label: `${row.name} (${row.code})` }));
}

export function unlinkedUserOptions(db: DbLike): SelectOption[] {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(and(isNull(employees.id), eq(users.status, "active")))
    .orderBy(asc(users.name))
    .all()
    .map((row) => ({ id: row.id, label: `${row.name} <${row.email}>` }));
}

export function getEmployeeByUserId(db: DbLike, userId: number): EmployeeRow | undefined {
  return db.select().from(employees).where(eq(employees.userId, userId)).get();
}
