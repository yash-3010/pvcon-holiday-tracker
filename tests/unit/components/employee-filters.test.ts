import { describe, expect, it } from "vitest";
import { filterEmployees } from "@/components/employees/filters";

const rows = [
  { id: 1, status: "active" as const, departmentId: 1 },
  { id: 2, status: "on_notice" as const, departmentId: 2 },
  { id: 3, status: "exited" as const, departmentId: 1 },
];
const ids = (list: { id: number }[]) => list.map((r) => r.id);

describe("filterEmployees", () => {
  it("shows current employees by default and filters by status and department", () => {
    expect(ids(filterEmployees(rows, { status: "current", departmentId: null }))).toEqual([1, 2]);
    expect(ids(filterEmployees(rows, { status: "exited", departmentId: null }))).toEqual([3]);
    expect(ids(filterEmployees(rows, { status: "all", departmentId: 1 }))).toEqual([1, 3]);
  });
});
