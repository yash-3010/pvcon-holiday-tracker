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
