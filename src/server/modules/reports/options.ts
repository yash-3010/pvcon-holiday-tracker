import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { formatPeriod } from "@/lib/dates";
import { RUN_TYPE_LABELS } from "@/lib/payroll/constants";
import type { DbLike } from "@/server/db/client";
import { departments, employees, payrollRuns, projects } from "@/server/db/schema";
import type { FilterKind } from "./types";

export interface FilterOptions {
  departments: { id: number; label: string }[];
  employees: { id: number; label: string }[];
  projects: { id: number; label: string }[];
  runs: { id: number; label: string }[];
}

/** Choices for a report's select filters; employees are limited to the viewer's scope. */
export function filterOptions(db: DbLike, filters: readonly FilterKind[], scope: number[] | null): FilterOptions {
  const has = (f: FilterKind) => filters.includes(f);
  return {
    departments: has("department")
      ? db.select({ id: departments.id, label: departments.name }).from(departments).where(eq(departments.archived, false)).orderBy(asc(departments.name)).all()
      : [],
    employees: has("employee")
      ? db
          .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode })
          .from(employees)
          .where(scope === null ? undefined : inArray(employees.id, scope.length ? scope : [-1]))
          .orderBy(asc(employees.displayName))
          .all()
          .map((e) => ({ id: e.id, label: `${e.name} (${e.code})` }))
      : [],
    projects: has("project")
      ? db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects).orderBy(asc(projects.code)).all().map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` }))
      : [],
    runs: has("run")
      ? db
          .select({ id: payrollRuns.id, period: payrollRuns.period, type: payrollRuns.type })
          .from(payrollRuns)
          .where(and(ne(payrollRuns.status, "cancelled"), ne(payrollRuns.status, "draft")))
          .orderBy(desc(payrollRuns.period), desc(payrollRuns.id))
          .all()
          .map((r) => ({ id: r.id, label: `${formatPeriod(r.period)} · ${RUN_TYPE_LABELS[r.type]}` }))
      : [],
  };
}
