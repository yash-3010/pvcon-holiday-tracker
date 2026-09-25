import { departments, designations, employees, type DepartmentRow, type DesignationRow, type EmployeeRow } from "@/server/db/schema";
import type { DbLike } from "@/server/db/client";

let seq = 0;

/** Raw insert for tests that need an employee row without the service's rules. */
export function insertEmployee(db: DbLike, overrides: Partial<typeof employees.$inferInsert> = {}): EmployeeRow {
  seq += 1;
  const firstName = overrides.firstName ?? `Emp${seq}`;
  const lastName = overrides.lastName ?? "Test";
  return db
    .insert(employees)
    .values({
      employeeCode: `T${String(seq).padStart(5, "0")}`,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      dateOfJoining: "2026-01-01",
      ...overrides,
    })
    .returning()
    .get();
}

export function insertDepartment(db: DbLike, name: string, overrides: Partial<typeof departments.$inferInsert> = {}): DepartmentRow {
  return db.insert(departments).values({ name, ...overrides }).returning().get();
}

export function insertDesignation(db: DbLike, name: string, overrides: Partial<typeof designations.$inferInsert> = {}): DesignationRow {
  return db.insert(designations).values({ name, ...overrides }).returning().get();
}
