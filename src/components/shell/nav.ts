import {
  BadgeCheck, Banknote, Bell, Blocks, Building, Building2, CalendarClock, CalendarCog, CalendarDays, CalendarRange, ClipboardClock,
  ClipboardList, Clock, Contact, FileText, Fingerprint, FolderKanban, Gift, Grid3x3, HandCoins, Handshake, House, IdCard, Inbox,
  Landmark, Layers, ListChecks, Network, PartyPopper, Receipt, ReceiptText, Scale, ScrollText, Shapes, ShieldCheck, Tags, Timer, Upload,
  UserRound, UserRoundCheck, Users, Wallet, type LucideIcon,
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

/** Phase 6 adds Reports. */
export const NAV: NavGroup[] = [
  {
    title: "Home",
    items: [
      { title: "Dashboard", href: "/", icon: House },
      {
        title: "Approvals", href: "/approvals", icon: Inbox,
        anyOf: ["employee.update", "leave.approve", "regularization.approve", "compoff.approve", "timesheet.approve", "claim.approve"],
      },
      { title: "Notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    title: "My Space",
    items: [
      { title: "My profile", href: "/me/profile", icon: UserRound, requiresEmployee: true },
      { title: "My documents", href: "/me/documents", icon: FileText, requiresEmployee: true },
      { title: "My attendance", href: "/me/attendance", icon: Fingerprint, requiresEmployee: true },
      { title: "My timesheets", href: "/me/timesheets", icon: ClipboardClock, requiresEmployee: true },
      { title: "My leave", href: "/me/leave", icon: CalendarDays, requiresEmployee: true },
      { title: "My comp-off", href: "/me/comp-off", icon: Gift, requiresEmployee: true },
      { title: "My payslips", href: "/me/payslips", icon: ReceiptText, requiresEmployee: true },
      { title: "My claims", href: "/me/claims", icon: Receipt, requiresEmployee: true },
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
    title: "Time",
    items: [
      { title: "Today", href: "/time/attendance", icon: UserRoundCheck, anyOf: ["attendance.view.all", "regularization.approve"] },
      { title: "Muster roll", href: "/time/muster", icon: Grid3x3, anyOf: ["attendance.view.all", "regularization.approve"] },
      { title: "Shifts", href: "/time/shifts", icon: Clock, anyOf: ["shift.manage"] },
      { title: "Projects", href: "/time/projects", icon: FolderKanban, anyOf: ["project.manage", "timesheet.view.all"] },
      { title: "Clients", href: "/time/clients", icon: Handshake, anyOf: ["project.manage"] },
      { title: "Task categories", href: "/time/categories", icon: Shapes, anyOf: ["project.manage"] },
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
      { title: "Comp-off", href: "/leave/comp-off", icon: Gift, anyOf: ["leave.view.all"] },
    ],
  },
  {
    title: "Payroll",
    items: [
      { title: "Payroll runs", href: "/payroll/runs", icon: Banknote, anyOf: ["payroll.run", "payroll.approve", "payroll.release"] },
      { title: "Salaries", href: "/payroll/salaries", icon: Wallet, anyOf: ["salary.view", "salary.manage"] },
      { title: "Components", href: "/payroll/components", icon: Blocks, anyOf: ["payroll.configure"] },
      { title: "Structures", href: "/payroll/structures", icon: Layers, anyOf: ["payroll.configure"] },
      { title: "Loans", href: "/payroll/loans", icon: HandCoins, anyOf: ["loan.manage"] },
      { title: "Claims", href: "/payroll/claims", icon: Receipt, anyOf: ["claim.view.all"] },
    ],
  },
  {
    title: "Settings",
    items: [
      { title: "Company", href: "/settings/company", icon: Building2, anyOf: ["settings.manage"] },
      { title: "Employee codes", href: "/settings/employee", icon: IdCard, anyOf: ["settings.manage"] },
      { title: "Attendance", href: "/settings/attendance", icon: CalendarClock, anyOf: ["attendance.manage"] },
      { title: "Leave", href: "/settings/leave", icon: CalendarCog, anyOf: ["leave.config"] },
      { title: "Comp-off", href: "/settings/comp-off", icon: Gift, anyOf: ["leave.config"] },
      { title: "Payroll", href: "/settings/payroll", icon: Landmark, anyOf: ["payroll.configure"] },
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
