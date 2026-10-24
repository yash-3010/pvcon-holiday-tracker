import { eq } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DbLike } from "@/server/db/client";
import { employees } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import type { FileKind } from "@/server/modules/files/service";

export const PHOTO_KINDS: FileKind[] = ["png", "jpeg", "webp"];
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** Employees change their own photo; `employee.update` holders anyone's. */
export function canChangePhoto(user: Pick<SessionUser, "employeeId" | "permissions">, employeeId: number): boolean {
  return user.employeeId === employeeId || can(user, "employee.update");
}

/** Whether the file is someone's photo: shown on most pages, never changed in place (a new photo is a new file). */
export function isEmployeePhoto(db: DbLike, fileId: number): boolean {
  return !!db.select({ id: employees.id }).from(employees).where(eq(employees.photoFileId, fileId)).get();
}

/** Sets (or with null clears) an employee's photo. Colleagues see it in the directory and on profiles. */
export function setEmployeePhoto(db: DbLike, employeeId: number, fileId: number | null): { before: number | null; after: number | null } {
  const row = db.select({ photoFileId: employees.photoFileId }).from(employees).where(eq(employees.id, employeeId)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Employee not found.");
  db.update(employees).set({ photoFileId: fileId }).where(eq(employees.id, employeeId)).run();
  return { before: row.photoFileId, after: fileId };
}
