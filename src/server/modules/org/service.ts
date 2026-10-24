import { and, count, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { DepartmentInput, DesignationInput } from "@/lib/validation/org";
import type { DbLike } from "@/server/db/client";
import { departments, designations, employees, type DepartmentRow, type DesignationRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";

function currentEmployeeCount(db: DbLike, where: SQL): number {
  return (
    db
      .select({ n: count() })
      .from(employees)
      .where(and(where, inArray(employees.status, ["active", "on_notice"])))
      .get()?.n ?? 0
  );
}

function requireDepartment(db: DbLike, id: number): DepartmentRow {
  const row = db.select().from(departments).where(eq(departments.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Department not found.");
  return row;
}

function assertDepartmentUnique(db: DbLike, input: DepartmentInput, exceptId: number | null): void {
  const others = exceptId === null ? undefined : ne(departments.id, exceptId);
  const nameClash = db
    .select({ id: departments.id })
    .from(departments)
    .where(and(sql`lower(${departments.name}) = ${input.name.toLowerCase()}`, others))
    .get();
  if (nameClash) throw new DomainError("DUPLICATE_NAME", "A department with this name already exists.", { name: ["Already exists"] });
  if (input.code) {
    const codeClash = db.select({ id: departments.id }).from(departments).where(and(eq(departments.code, input.code), others)).get();
    if (codeClash) throw new DomainError("DUPLICATE_CODE", "This department code is already used.", { code: ["Already used"] });
  }
}

/** The parent must be active and must not be the department itself or one of its descendants. */
function assertParent(db: DbLike, id: number | null, parentId: number | null): void {
  if (parentId === null) return;
  const parent = db.select().from(departments).where(eq(departments.id, parentId)).get();
  if (!parent) throw new DomainError("NOT_FOUND", "Parent department not found.", { parentId: ["Not found"] });
  if (parent.archived) throw new DomainError("ARCHIVED", "Choose an active parent department.", { parentId: ["Archived"] });
  if (id === null) return;
  const seen = new Set<number>();
  let current: number | null = parentId;
  while (current !== null && !seen.has(current)) {
    if (current === id) {
      throw new DomainError("DEPARTMENT_CYCLE", "A department can't sit under itself or one of its sub-departments.", {
        parentId: ["Creates a loop"],
      });
    }
    seen.add(current);
    current = db.select({ parentId: departments.parentId }).from(departments).where(eq(departments.id, current)).get()?.parentId ?? null;
  }
}

function assertHead(db: DbLike, headEmployeeId: number | null): void {
  if (headEmployeeId === null) return;
  const head = db.select({ status: employees.status }).from(employees).where(eq(employees.id, headEmployeeId)).get();
  if (!head || head.status === "exited") {
    throw new DomainError("INVALID_HEAD", "Choose a current employee as department head.", { headEmployeeId: ["Not a current employee"] });
  }
}

export function createDepartment(db: DbLike, input: DepartmentInput): DepartmentRow {
  assertDepartmentUnique(db, input, null);
  assertParent(db, null, input.parentId);
  assertHead(db, input.headEmployeeId);
  return db.insert(departments).values(input).returning().get();
}

export function updateDepartment(db: DbLike, id: number, input: DepartmentInput): { before: DepartmentRow; after: DepartmentRow } {
  const before = requireDepartment(db, id);
  assertDepartmentUnique(db, input, id);
  if (input.parentId !== before.parentId || input.parentId === id) assertParent(db, id, input.parentId);
  if (input.headEmployeeId !== before.headEmployeeId) assertHead(db, input.headEmployeeId);
  const after = db.update(departments).set(input).where(eq(departments.id, id)).returning().get()!;
  return { before, after };
}

export function setDepartmentArchived(db: DbLike, id: number, archived: boolean): DepartmentRow {
  requireDepartment(db, id);
  if (archived) {
    const members = currentEmployeeCount(db, eq(employees.departmentId, id));
    if (members > 0) {
      throw new DomainError("DEPARTMENT_IN_USE", `Move this department's ${members} current employee(s) to another department first.`);
    }
    const children = db
      .select({ n: count() })
      .from(departments)
      .where(and(eq(departments.parentId, id), eq(departments.archived, false)))
      .get()?.n ?? 0;
    if (children > 0) throw new DomainError("DEPARTMENT_HAS_CHILDREN", "Archive or move its sub-departments first.");
  }
  return db.update(departments).set({ archived }).where(eq(departments.id, id)).returning().get()!;
}

function requireDesignation(db: DbLike, id: number): DesignationRow {
  const row = db.select().from(designations).where(eq(designations.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Designation not found.");
  return row;
}

function assertDesignationUnique(db: DbLike, name: string, exceptId: number | null): void {
  const clash = db
    .select({ id: designations.id })
    .from(designations)
    .where(and(sql`lower(${designations.name}) = ${name.toLowerCase()}`, exceptId === null ? undefined : ne(designations.id, exceptId)))
    .get();
  if (clash) throw new DomainError("DUPLICATE_NAME", "A designation with this name already exists.", { name: ["Already exists"] });
}

export function createDesignation(db: DbLike, input: DesignationInput): DesignationRow {
  assertDesignationUnique(db, input.name, null);
  return db.insert(designations).values(input).returning().get();
}

export function updateDesignation(db: DbLike, id: number, input: DesignationInput): { before: DesignationRow; after: DesignationRow } {
  const before = requireDesignation(db, id);
  assertDesignationUnique(db, input.name, id);
  const after = db.update(designations).set(input).where(eq(designations.id, id)).returning().get()!;
  return { before, after };
}

export function setDesignationArchived(db: DbLike, id: number, archived: boolean): DesignationRow {
  requireDesignation(db, id);
  if (archived) {
    const holders = currentEmployeeCount(db, eq(employees.designationId, id));
    if (holders > 0) {
      throw new DomainError("DESIGNATION_IN_USE", `${holders} current employee(s) hold this designation. Change theirs first.`);
    }
  }
  return db.update(designations).set({ archived }).where(eq(designations.id, id)).returning().get()!;
}
