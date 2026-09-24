import { describe, expect, it } from "vitest";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { isActivePath, visibleNav } from "@/components/shell/nav";

const hrefs = (roles: Parameters<typeof permissionsForRoles>[0]) =>
  visibleNav(permissionsForRoles(roles)).flatMap((g) => g.items.map((i) => i.href));

describe("navigation", () => {
  it("shows employees only the home group", () => {
    expect(visibleNav(permissionsForRoles(["employee"])).map((g) => g.title)).toEqual(["Home"]);
  });
  it("shows HR users & roles but not company settings or jobs", () => {
    const items = hrefs(["hr_admin"]);
    expect(items).toContain("/settings/users");
    expect(items).not.toContain("/settings/company");
    expect(items).not.toContain("/settings/jobs");
  });
  it("shows super admins every settings page", () => {
    expect(hrefs(["super_admin"])).toEqual(
      expect.arrayContaining(["/settings/company", "/settings/users", "/settings/security", "/settings/audit", "/settings/jobs"]),
    );
  });
  it("matches active paths by segment", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/settings/users", "/")).toBe(false);
    expect(isActivePath("/settings/users/5", "/settings/users")).toBe(true);
    expect(isActivePath("/settings/usersx", "/settings/users")).toBe(false);
  });
});
