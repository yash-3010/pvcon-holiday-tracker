import type { EmployeeStatus } from "@/lib/hr";

/** "current" = active or on notice. */
export type StatusFilter = "current" | "all" | EmployeeStatus;

export function filterEmployees<T extends { status: EmployeeStatus; departmentId: number | null }>(
  rows: T[],
  filter: { status: StatusFilter; departmentId: number | null },
): T[] {
  return rows.filter((row) => {
    const statusOk =
      filter.status === "all" || (filter.status === "current" ? row.status !== "exited" : row.status === filter.status);
    return statusOk && (filter.departmentId === null || row.departmentId === filter.departmentId);
  });
}

export function filterDirectory<
  T extends { displayName: string; employeeCode: string; workEmail: string | null; designationName: string | null; departmentId: number | null },
>(rows: T[], filter: { query: string; departmentId: number | null }): T[] {
  const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filter.departmentId !== null && row.departmentId !== filter.departmentId) return false;
    const haystack = [row.displayName, row.employeeCode, row.workEmail ?? "", row.designationName ?? ""].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
