import { asc, count, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { SelectOption } from "@/lib/hr";
import type { DbLike } from "@/server/db/client";
import { departments, designations, employees } from "@/server/db/schema";

export interface DepartmentListItem {
  id: number;
  name: string;
  code: string | null;
  parentId: number | null;
  parentName: string | null;
  headEmployeeId: number | null;
  headName: string | null;
  archived: boolean;
  employeeCount: number;
}

export interface DesignationListItem {
  id: number;
  name: string;
  level: number | null;
  archived: boolean;
  employeeCount: number;
}

function currentCounts(db: DbLike, column: typeof employees.departmentId | typeof employees.designationId): Map<number | null, number> {
  const rows = db
    .select({ key: column, n: count() })
    .from(employees)
    .where(inArray(employees.status, ["active", "on_notice"]))
    .groupBy(column)
    .all();
  return new Map(rows.map((r) => [r.key, r.n]));
}

export function listDepartments(db: DbLike): DepartmentListItem[] {
  const parent = alias(departments, "parent");
  const counts = currentCounts(db, employees.departmentId);
  return db
    .select({
      id: departments.id,
      name: departments.name,
      code: departments.code,
      parentId: departments.parentId,
      parentName: parent.name,
      headEmployeeId: departments.headEmployeeId,
      headName: employees.displayName,
      archived: departments.archived,
    })
    .from(departments)
    .leftJoin(parent, eq(parent.id, departments.parentId))
    .leftJoin(employees, eq(employees.id, departments.headEmployeeId))
    .orderBy(asc(departments.name))
    .all()
    .map((row) => ({ ...row, employeeCount: counts.get(row.id) ?? 0 }));
}

export function listDesignations(db: DbLike): DesignationListItem[] {
  const counts = currentCounts(db, employees.designationId);
  return db
    .select({ id: designations.id, name: designations.name, level: designations.level, archived: designations.archived })
    .from(designations)
    .orderBy(asc(designations.name))
    .all()
    .map((row) => ({ ...row, employeeCount: counts.get(row.id) ?? 0 }));
}

export function departmentOptions(db: DbLike): SelectOption[] {
  return db
    .select({ id: departments.id, label: departments.name })
    .from(departments)
    .where(eq(departments.archived, false))
    .orderBy(asc(departments.name))
    .all();
}

export function designationOptions(db: DbLike): SelectOption[] {
  return db
    .select({ id: designations.id, label: designations.name })
    .from(designations)
    .where(eq(designations.archived, false))
    .orderBy(asc(designations.name))
    .all();
}
