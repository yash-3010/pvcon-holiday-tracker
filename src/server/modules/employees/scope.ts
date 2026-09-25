import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DbLike } from "@/server/db/client";
import { employees } from "@/server/db/schema";

export type ScopeUser = Pick<SessionUser, "permissions" | "employeeId">;

/**
 * Every employee below `managerEmployeeId`, direct and indirect, sorted by id.
 * `union` (not `union all`) makes the recursion stop even if stored data contains a reporting loop.
 */
export function getReportingTree(db: DbLike, managerEmployeeId: number): number[] {
  return db
    .all<{ id: number }>(
      sql`with recursive tree(id) as (
            select id from employees where reporting_manager_id = ${managerEmployeeId}
            union
            select e.id from employees e join tree on e.reporting_manager_id = tree.id
          )
          select id from tree where id <> ${managerEmployeeId} order by id`,
    )
    .map((row) => row.id);
}

/** Current (active or on-notice) direct reports. */
export function getDirectReportIds(db: DbLike, managerEmployeeId: number): number[] {
  return db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.reportingManagerId, managerEmployeeId), inArray(employees.status, ["active", "on_notice"])))
    .orderBy(asc(employees.id))
    .all()
    .map((row) => row.id);
}

export function employeeContextForUser(db: DbLike, userId: number): { employeeId: number | null; hasReports: boolean } {
  const employee = db.select({ id: employees.id }).from(employees).where(eq(employees.userId, userId)).get();
  if (!employee) return { employeeId: null, hasReports: false };
  return { employeeId: employee.id, hasReports: getDirectReportIds(db, employee.id).length > 0 };
}

/**
 * True when `user` may act on `employeeId` as an org-wide viewer (`employee.view`) or as a manager above them.
 * Self is deliberately not "in scope" so approvals can never be self-approvals; use `canViewEmployee` for viewing.
 */
export function isInScope(db: DbLike, user: ScopeUser, employeeId: number): boolean {
  if (can(user, "employee.view")) return true;
  if (user.employeeId === null || user.employeeId === employeeId) return false;
  return getReportingTree(db, user.employeeId).includes(employeeId);
}

export function canViewEmployee(db: DbLike, user: ScopeUser, employeeId: number): boolean {
  return user.employeeId === employeeId || isInScope(db, user, employeeId);
}

/** Employee ids whose profile `user` may open: everyone for org-wide viewers, else self plus reporting tree. */
export function viewableEmployeeIds(db: DbLike, user: ScopeUser): "all" | number[] {
  if (can(user, "employee.view")) return "all";
  if (user.employeeId === null) return [];
  return [user.employeeId, ...getReportingTree(db, user.employeeId)];
}
