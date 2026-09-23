import { describe, expect, it } from "vitest";
import {
  PERMISSIONS, ROLE_PERMISSIONS, ROLES, can, canAny, isPrivilegedRole, isRole, permissionsForRoles,
} from "@/lib/auth/permissions";

const holder = (...roles: (typeof ROLES)[number][]) => ({ permissions: permissionsForRoles(roles) });

describe("permissions", () => {
  it("gives employees self-service only", () => {
    const u = holder("employee");
    expect(can(u, "directory.view")).toBe(true);
    expect(can(u, "employee.view")).toBe(false);
    expect(can(u, "leave.approve")).toBe(false);
  });

  it("gives managers team approvals but not org-wide views", () => {
    const u = holder("employee", "manager");
    expect(can(u, "leave.approve")).toBe(true);
    expect(can(u, "compoff.approve")).toBe(true);
    expect(can(u, "leave.view.all")).toBe(false);
  });

  it("keeps salaries away from HR and HR tools away from payroll", () => {
    const hr = holder("hr_admin");
    expect(can(hr, "employee.create")).toBe(true);
    expect(can(hr, "user.manage")).toBe(true);
    expect(can(hr, "salary.view")).toBe(false);
    expect(can(hr, "payroll.run")).toBe(false);
    expect(can(hr, "role.assign")).toBe(false);
    const payroll = holder("payroll_admin");
    expect(can(payroll, "payroll.approve")).toBe(true);
    expect(can(payroll, "employee.create")).toBe(false);
  });

  it("gives super admins everything", () => {
    const u = holder("super_admin");
    for (const p of PERMISSIONS) expect(can(u, p)).toBe(true);
  });

  it("unions and de-duplicates role permissions", () => {
    const perms = permissionsForRoles(["manager", "hr_admin"]);
    expect(new Set(perms).size).toBe(perms.length);
    expect(perms).toEqual([...perms].sort());
  });

  it("only uses known permissions in role maps", () => {
    for (const role of ROLES) for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
  });

  it("has helpers for role checks", () => {
    expect(isRole("manager")).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(isPrivilegedRole("hr_admin")).toBe(true);
    expect(isPrivilegedRole("manager")).toBe(false);
    expect(canAny(holder("employee"), ["employee.view", "directory.view"])).toBe(true);
    expect(can(null, "directory.view")).toBe(false);
  });
});
