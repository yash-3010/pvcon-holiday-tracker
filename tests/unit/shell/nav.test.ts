import { describe, expect, it } from "vitest";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { isActivePath, visibleNav } from "@/components/shell/nav";

const hrefs = (roles: Parameters<typeof permissionsForRoles>[0], hasEmployee = false) =>
  visibleNav(permissionsForRoles(roles), { hasEmployee }).flatMap((g) => g.items.map((i) => i.href));

describe("navigation", () => {
  it("shows employees home and the directory, and My Space once linked to an employee record", () => {
    const employee = permissionsForRoles(["employee"]);
    expect(visibleNav(employee).map((g) => g.title)).toEqual(["Home", "Organization"]);
    expect(visibleNav(employee, { hasEmployee: true }).map((g) => g.title)).toEqual(["Home", "My Space", "Organization"]);
    expect(hrefs(["employee"])).toEqual(["/", "/notifications", "/org/directory", "/org/chart"]);
  });

  it("shows HR the org masters, approvals and users, but not company settings or jobs", () => {
    const items = hrefs(["hr_admin"]);
    expect(items).toEqual(
      expect.arrayContaining(["/approvals", "/org/employees", "/org/departments", "/org/checklists", "/org/import", "/settings/users"]),
    );
    expect(items).not.toContain("/settings/company");
    expect(items).not.toContain("/settings/jobs");
  });

  it("shows super admins every settings page", () => {
    expect(hrefs(["super_admin"])).toEqual(
      expect.arrayContaining([
        "/settings/company", "/settings/employee", "/settings/users", "/settings/security", "/settings/audit", "/settings/jobs",
      ]),
    );
  });

  it("matches active paths by segment", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/settings/users", "/")).toBe(false);
    expect(isActivePath("/settings/users/5", "/settings/users")).toBe(true);
    expect(isActivePath("/settings/usersx", "/settings/users")).toBe(false);
  });
});
