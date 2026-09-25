import {
  BadgeCheck, Bell, Building, Building2, Contact, FileText, House, IdCard, Inbox, ListChecks, Network, ScrollText,
  ShieldCheck, Timer, Upload, UserRound, Users, type LucideIcon,
} from "lucide-react";
import { canAny, type Permission } from "@/lib/auth/permissions";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Visible when the user has any of these permissions; omit for everyone. */
  anyOf?: Permission[];
  /** Self-service pages: only for logins linked to an employee record. */
  requiresEmployee?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Later phases add groups (Team, Time, Leave, Payroll, Reports) and widen `anyOf` for Approvals. */
export const NAV: NavGroup[] = [
  {
    title: "Home",
    items: [
      { title: "Dashboard", href: "/", icon: House },
      { title: "Approvals", href: "/approvals", icon: Inbox, anyOf: ["employee.update"] },
      { title: "Notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    title: "My Space",
    items: [
      { title: "My profile", href: "/me/profile", icon: UserRound, requiresEmployee: true },
      { title: "My documents", href: "/me/documents", icon: FileText, requiresEmployee: true },
    ],
  },
  {
    title: "Organization",
    items: [
      { title: "Employees", href: "/org/employees", icon: Users, anyOf: ["employee.view"] },
      { title: "Directory", href: "/org/directory", icon: Contact, anyOf: ["directory.view"] },
      { title: "Org chart", href: "/org/chart", icon: Network, anyOf: ["directory.view"] },
      { title: "Departments", href: "/org/departments", icon: Building, anyOf: ["org.manage"] },
      { title: "Designations", href: "/org/designations", icon: BadgeCheck, anyOf: ["org.manage"] },
      { title: "Checklists", href: "/org/checklists", icon: ListChecks, anyOf: ["employee.update"] },
      { title: "Import", href: "/org/import", icon: Upload, anyOf: ["employee.import"] },
    ],
  },
  {
    title: "Settings",
    items: [
      { title: "Company", href: "/settings/company", icon: Building2, anyOf: ["settings.manage"] },
      { title: "Employee codes", href: "/settings/employee", icon: IdCard, anyOf: ["settings.manage"] },
      { title: "Users & roles", href: "/settings/users", icon: Users, anyOf: ["user.manage", "role.assign"] },
      { title: "Security", href: "/settings/security", icon: ShieldCheck, anyOf: ["settings.manage"] },
      { title: "Audit log", href: "/settings/audit", icon: ScrollText, anyOf: ["audit.view"] },
      { title: "Jobs", href: "/settings/jobs", icon: Timer, anyOf: ["job.run"] },
    ],
  },
];

export function visibleNav(permissions: readonly Permission[], opts: { hasEmployee?: boolean } = {}): NavGroup[] {
  const holder = { permissions };
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => (!item.anyOf || canAny(holder, item.anyOf)) && (!item.requiresEmployee || opts.hasEmployee === true),
    ),
  })).filter((group) => group.items.length > 0);
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
