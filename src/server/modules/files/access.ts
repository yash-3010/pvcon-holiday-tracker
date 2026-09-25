import { eq } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DbLike } from "@/server/db/client";
import { employeeDocuments, type FileRow } from "@/server/db/schema";
import { getSetting } from "@/server/modules/settings/service";

export type FileAccessResolver = (db: DbLike, user: SessionUser, file: FileRow) => boolean;

/**
 * A file is readable when any resolver allows it.
 * Later phases append resolvers here (payslips, receipts, …).
 */
const RESOLVERS: FileAccessResolver[] = [
  (_db, user, file) => file.uploadedBy === user.id,
  (_db, user) => user.roles.includes("super_admin"),
  (db, _user, file) => getSetting(db, "company").logoFileId === file.id,
  // Employee documents are as private as Personal and Bank & IDs: the employee themself and org-wide viewers
  // (`employee.view`: HR, payroll, super admin) only. A manager above does NOT get them — id_proof/address_proof
  // scans carry the same data spec §3.4 restricts for bank/ID numbers.
  (db, user, file) => {
    const doc = db
      .select({ employeeId: employeeDocuments.employeeId })
      .from(employeeDocuments)
      .where(eq(employeeDocuments.fileId, file.id))
      .get();
    return !!doc && (can(user, "document.manage") || can(user, "employee.view") || user.employeeId === doc.employeeId);
  },
];

export function canAccessFile(db: DbLike, user: SessionUser, file: FileRow): boolean {
  return RESOLVERS.some((resolve) => resolve(db, user, file));
}
