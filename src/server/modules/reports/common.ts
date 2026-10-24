import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import type { ISODate } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import { departments, designations, employees, type EmployeeRow } from "@/server/db/schema";
import { employedDuring } from "@/server/modules/attendance/compute";
import type { ReportContext } from "./types";

export type ReportEmployee = EmployeeRow & { department: string | null; designation: string | null };

/**
 * The employees a report covers: the viewer's scope, a department if chosen, and those employed on some day of
 * [from, to] when given. Ordered by employee code.
 */
export function reportEmployees(
  db: DbLike,
  ctx: Pick<ReportContext, "scope">,
  { departmentId = null, from, to, employeeId = null, where }: { departmentId?: number | null; from?: ISODate; to?: ISODate; employeeId?: number | null; where?: SQL } = {},
): ReportEmployee[] {
  if (ctx.scope !== null && ctx.scope.length === 0) return [];
  return db
    .select({ employee: employees, department: departments.name, designation: designations.name })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(
      and(
        ctx.scope === null ? undefined : inArray(employees.id, ctx.scope),
        departmentId === null ? undefined : eq(employees.departmentId, departmentId),
        employeeId === null ? undefined : eq(employees.id, employeeId),
        from && to ? employedDuring(from, to) : undefined,
        where,
      ),
    )
    .orderBy(asc(employees.employeeCode))
    .all()
    .map(({ employee, department, designation }) => ({ ...employee, department, designation }));
}

/** Rounds a ratio to a percentage with one decimal; null when there is nothing to divide by. */
export const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
