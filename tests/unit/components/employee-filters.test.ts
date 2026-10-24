import { describe, expect, it } from "vitest";
import { filterDirectory, filterEmployees } from "@/components/employees/filters";

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

describe("filterDirectory", () => {
  const people = [
    { id: 1, displayName: "Asha Rao", employeeCode: "PV0001", workEmail: "asha@pvcon.in", designationName: "Consultant", departmentId: 1 },
    { id: 2, displayName: "Ravi Menon", employeeCode: "PV0002", workEmail: null, designationName: "Analyst", departmentId: 2 },
  ];

  it("matches every search term against name, code, email and designation", () => {
    expect(ids(filterDirectory(people, { query: "", departmentId: null }))).toEqual([1, 2]);
    expect(ids(filterDirectory(people, { query: "rao pv0001", departmentId: null }))).toEqual([1]);
    expect(ids(filterDirectory(people, { query: "ANALYST", departmentId: null }))).toEqual([2]);
    expect(ids(filterDirectory(people, { query: "asha", departmentId: 2 }))).toEqual([]);
  });
});
