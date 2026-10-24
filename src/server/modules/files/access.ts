import { eq } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DbLike } from "@/server/db/client";
import { employeeDocuments, expenseClaims, leaveRequests, payslips, type FileRow } from "@/server/db/schema";
import { canDecideLeave } from "@/server/modules/leave/requests";
import { canViewPayslip } from "@/server/modules/payroll/access";
import { canDecideClaim } from "@/server/modules/payroll/claims";
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
  (db, user, file) => can(user, "payroll.configure") && getSetting(db, "payroll").signatoryImageFileId === file.id,
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
  // A leave document (e.g. a medical note) is for the employee, org-wide leave viewers and whoever may decide the leave.
  (db, user, file) => {
    const request = db
      .select({ employeeId: leaveRequests.employeeId })
      .from(leaveRequests)
      .where(eq(leaveRequests.attachmentFileId, file.id))
      .get();
    return (
      !!request &&
      (user.employeeId === request.employeeId || can(user, "leave.view.all") || canDecideLeave(db, user, request.employeeId))
    );
  },
  // An expense receipt is for the claimant, org-wide claim viewers and whoever may decide the claim.
  (db, user, file) => {
    const claim = db
      .select({ employeeId: expenseClaims.employeeId })
      .from(expenseClaims)
      .where(eq(expenseClaims.receiptFileId, file.id))
      .get();
    return (
      !!claim &&
      (user.employeeId === claim.employeeId || can(user, "claim.view.all") || canDecideClaim(db, user, claim.employeeId))
    );
  },
  // A frozen payslip PDF is for its employee once released, and for payroll and salary viewers.
  (db, user, file) => {
    const payslip = db
      .select({ employeeId: payslips.employeeId, releasedAt: payslips.releasedAt })
      .from(payslips)
      .where(eq(payslips.pdfFileId, file.id))
      .get();
    return !!payslip && canViewPayslip(user, payslip);
  },
];

export function canAccessFile(db: DbLike, user: SessionUser, file: FileRow): boolean {
  return RESOLVERS.some((resolve) => resolve(db, user, file));
}
