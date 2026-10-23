import { eq } from "drizzle-orm";
import { can, type Permission } from "@/lib/auth/permissions";
import type { DbLike } from "@/server/db/client";
import { employees, users } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { isManagerAbove, type ScopeUser } from "@/server/modules/employees/scope";
import { activeUserIdsWithPermission } from "@/server/modules/users/service";

/** Who may decide a kind of request: holders of `approve` who are org-wide (`orgWide`) or a manager above the employee. */
export interface ApprovalRight {
  approve: Permission;
  orgWide: Permission;
}

export const LEAVE_APPROVAL: ApprovalRight = { approve: "leave.approve", orgWide: "leave.view.all" };
export const COMP_OFF_APPROVAL: ApprovalRight = { approve: "compoff.approve", orgWide: "leave.view.all" };
export const REGULARIZATION_APPROVAL: ApprovalRight = { approve: "regularization.approve", orgWide: "attendance.view.all" };
export const TIMESHEET_APPROVAL: ApprovalRight = { approve: "timesheet.approve", orgWide: "timesheet.view.all" };

/** Never true for one's own requests, even for org-wide approvers. */
export function canDecideFor(db: DbLike, user: ScopeUser, employeeId: number, right: ApprovalRight): boolean {
  if (user.employeeId === employeeId || !can(user, right.approve)) return false;
  return can(user, right.orgWide) || isManagerAbove(db, user, employeeId);
}

/** Who to notify about a new request: the reporting manager's login, otherwise the org-wide approvers. Never the applicant. */
export function approverUserIdsFor(db: DbLike, employeeId: number, right: ApprovalRight): number[] {
  const employee = db.select().from(employees).where(eq(employees.id, employeeId)).get();
  if (!employee) throw new DomainError("NOT_FOUND", "Employee not found.");
  if (employee.reportingManagerId !== null) {
    const manager = db
      .select({ userId: employees.userId, status: employees.status, userStatus: users.status })
      .from(employees)
      .leftJoin(users, eq(users.id, employees.userId))
      .where(eq(employees.id, employee.reportingManagerId))
      .get();
    if (manager?.userId && manager.status !== "exited" && manager.userStatus === "active" && manager.userId !== employee.userId) {
      return [manager.userId];
    }
  }
  const orgWide = new Set(activeUserIdsWithPermission(db, right.orgWide));
  return activeUserIdsWithPermission(db, right.approve).filter((id) => orgWide.has(id) && id !== employee.userId);
}
