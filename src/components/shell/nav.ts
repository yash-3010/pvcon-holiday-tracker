import {
  BadgeCheck, Bell, Building, Building2, CalendarCog, CalendarDays, CalendarRange, ClipboardList, Contact, FileText, House,
  IdCard, Inbox, ListChecks, Network, PartyPopper, Scale, ScrollText, ShieldCheck, Tags, Timer, Upload, UserRound, Users,
  type LucideIcon,
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
  /** With `requiresEmployee`: also shown without an employee record to holders of any of these permissions. */
  employeeOrAnyOf?: Permission[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Later phases add groups (Time, Payroll, Reports) and widen `anyOf` for Approvals. */
export const NAV: NavGroup[] = [
  {
    title: "Home",
    items: [
      { title: "Dashboard", href: "/", icon: House },
      { title: "Approvals", href: "/approvals", icon: Inbox, anyOf: ["employee.update", "leave.approve"] },
      { title: "Notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    title: "My Space",
    items: [
      { title: "My profile", href: "/me/profile", icon: UserRound, requiresEmployee: true },
      { title: "My documents", href: "/me/documents", icon: FileText, requiresEmployee: true },
      { title: "My leave", href: "/me/leave", icon: CalendarDays, requiresEmployee: true },
    ],
  },
  {
    title: "Team",
    items: [
      {
        title: "Team calendar", href: "/team/calendar", icon: CalendarRange, requiresEmployee: true,
        employeeOrAnyOf: ["leave.view.all"],
      },
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
    title: "Leave",
    items: [
      { title: "Leave requests", href: "/leave/requests", icon: ClipboardList, anyOf: ["leave.view.all", "leave.approve"] },
      { title: "Balances", href: "/leave/balances", icon: Scale, anyOf: ["leave.view.all"] },
      { title: "Leave types", href: "/leave/types", icon: Tags, anyOf: ["leave.config"] },
      { title: "Holidays", href: "/leave/holidays", icon: PartyPopper, anyOf: ["holiday.manage"] },
    ],
  },
  {
    title: "Settings",
    items: [
      { title: "Company", href: "/settings/company", icon: Building2, anyOf: ["settings.manage"] },
      { title: "Employee codes", href: "/settings/employee", icon: IdCard, anyOf: ["settings.manage"] },
      { title: "Leave", href: "/settings/leave", icon: CalendarCog, anyOf: ["leave.config"] },
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
      (item) =>
        (!item.anyOf || canAny(holder, item.anyOf)) &&
        (!item.requiresEmployee || opts.hasEmployee === true || (!!item.employeeOrAnyOf && canAny(holder, item.employeeOrAnyOf))),
    ),
  })).filter((group) => group.items.length > 0);
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
