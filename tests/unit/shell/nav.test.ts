import { describe, expect, it } from "vitest";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { isActivePath, visibleNav } from "@/components/shell/nav";

const hrefs = (roles: Parameters<typeof permissionsForRoles>[0], hasEmployee = false) =>
  visibleNav(permissionsForRoles(roles), { hasEmployee }).flatMap((g) => g.items.map((i) => i.href));

describe("navigation", () => {
  it("shows employees home and the directory, and My Space once linked to an employee record", () => {
    const employee = permissionsForRoles(["employee"]);
    expect(visibleNav(employee).map((g) => g.title)).toEqual(["Home", "Organization"]);
    expect(visibleNav(employee, { hasEmployee: true }).map((g) => g.title)).toEqual(["Home", "My Space", "Team", "Organization"]);
    expect(hrefs(["employee"])).toEqual(["/", "/notifications", "/org/directory", "/org/chart"]);
    expect(hrefs(["employee"], true)).toEqual(expect.arrayContaining(["/me/leave", "/team/calendar"]));
    expect(hrefs(["employee"], true)).not.toContain("/approvals");
  });

  it("shows leave pages by permission", () => {
    expect(hrefs(["manager"], true)).toEqual(expect.arrayContaining(["/approvals", "/leave/requests", "/team/calendar"]));
    expect(hrefs(["manager"], true)).not.toContain("/leave/balances");
    expect(hrefs(["hr_admin"])).toEqual(
      expect.arrayContaining(["/team/calendar", "/leave/requests", "/leave/balances", "/leave/types", "/leave/holidays", "/settings/leave"]),
    );
    // Payroll reads leave (loss of pay) but neither decides nor configures it.
    expect(hrefs(["payroll_admin"])).toEqual(expect.arrayContaining(["/team/calendar", "/leave/requests", "/leave/balances"]));
    expect(hrefs(["payroll_admin"])).not.toContain("/leave/types");
    expect(hrefs(["payroll_admin"])).not.toContain("/approvals");
  });

  it("shows attendance and comp-off pages by permission", () => {
    expect(hrefs(["employee"], true)).toEqual(expect.arrayContaining(["/me/attendance", "/me/comp-off"]));
    expect(hrefs(["employee"], true)).not.toContain("/time/attendance");
    expect(hrefs(["manager"], true)).toEqual(expect.arrayContaining(["/time/attendance", "/time/muster"]));
    expect(hrefs(["manager"], true)).not.toContain("/time/shifts");
    expect(hrefs(["manager"], true)).not.toContain("/leave/comp-off");
    expect(hrefs(["hr_admin"])).toEqual(
      expect.arrayContaining(["/time/attendance", "/time/muster", "/time/shifts", "/leave/comp-off", "/settings/attendance", "/settings/comp-off"]),
    );
    expect(hrefs(["payroll_admin"])).toEqual(expect.arrayContaining(["/time/attendance", "/time/muster", "/leave/comp-off"]));
    expect(hrefs(["payroll_admin"])).not.toContain("/time/shifts");
    expect(visibleNav(permissionsForRoles(["hr_admin"])).map((g) => g.title)).toEqual(["Home", "Team", "Time", "Organization", "Leave", "Settings"]);
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
