import { Bell, Building2, House, ScrollText, ShieldCheck, Timer, Users, type LucideIcon } from "lucide-react";
import { canAny, type Permission } from "@/lib/auth/permissions";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Visible when the user has any of these permissions; omit for everyone. */
  anyOf?: Permission[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Later phases add groups (My Space, Team, Organization, Time, Leave, Payroll, Reports). */
export const NAV: NavGroup[] = [
  {
    title: "Home",
    items: [
      { title: "Dashboard", href: "/", icon: House },
      { title: "Notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    title: "Settings",
    items: [
      { title: "Company", href: "/settings/company", icon: Building2, anyOf: ["settings.manage"] },
      { title: "Users & roles", href: "/settings/users", icon: Users, anyOf: ["user.manage", "role.assign"] },
      { title: "Security", href: "/settings/security", icon: ShieldCheck, anyOf: ["settings.manage"] },
      { title: "Audit log", href: "/settings/audit", icon: ScrollText, anyOf: ["audit.view"] },
      { title: "Jobs", href: "/settings/jobs", icon: Timer, anyOf: ["job.run"] },
    ],
  },
];

export function visibleNav(permissions: readonly Permission[]): NavGroup[] {
  const holder = { permissions };
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.anyOf || canAny(holder, item.anyOf)),
  })).filter((group) => group.items.length > 0);
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
