export const ROLES = ["employee", "manager", "hr_admin", "payroll_admin", "super_admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  employee: "Employee",
  manager: "Manager",
  hr_admin: "HR Admin",
  payroll_admin: "Payroll Admin",
  super_admin: "Super Admin",
};

export const PERMISSIONS = [
  "directory.view",
  "employee.view",
  "employee.create",
  "employee.update",
  "employee.exit",
  "employee.import",
  "employee.sensitive.view",
  "document.manage",
  "org.manage",
  "attendance.view.all",
  "attendance.manage",
  "shift.manage",
  "regularization.approve",
  "timesheet.view.all",
  "timesheet.approve",
  "project.manage",
  "leave.view.all",
  "leave.approve",
  "leave.config",
  "leave.adjust",
  "holiday.manage",
  "compoff.approve",
  "salary.view",
  "salary.manage",
  "payroll.configure",
  "payroll.run",
  "payroll.approve",
  "payroll.release",
  "loan.manage",
  "claim.approve",
  "claim.pay",
  "report.hr",
  "report.attendance",
  "report.timesheet",
  "report.leave",
  "report.payroll",
  "announcement.manage",
  "settings.manage",
  "role.assign",
  "user.manage",
  "audit.view",
  "job.run",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const EMPLOYEE: Permission[] = ["directory.view"];

const MANAGER: Permission[] = [
  ...EMPLOYEE,
  "leave.approve",
  "compoff.approve",
  "regularization.approve",
  "timesheet.approve",
  "claim.approve",
  "report.attendance",
  "report.leave",
  "report.timesheet",
];

const HR_ADMIN: Permission[] = [
  ...MANAGER,
  "employee.view",
  "employee.create",
  "employee.update",
  "employee.exit",
  "employee.import",
  "employee.sensitive.view",
  "document.manage",
  "org.manage",
  "attendance.view.all",
  "attendance.manage",
  "shift.manage",
  "timesheet.view.all",
  "project.manage",
  "leave.view.all",
  "leave.config",
  "leave.adjust",
  "holiday.manage",
  "report.hr",
  "announcement.manage",
  "user.manage",
];

const PAYROLL_ADMIN: Permission[] = [
  ...EMPLOYEE,
  "employee.view",
  "employee.sensitive.view",
  "attendance.view.all",
  "leave.view.all",
  "salary.view",
  "salary.manage",
  "payroll.configure",
  "payroll.run",
  "payroll.approve",
  "payroll.release",
  "loan.manage",
  "claim.pay",
  "report.payroll",
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  employee: EMPLOYEE,
  manager: MANAGER,
  hr_admin: HR_ADMIN,
  payroll_admin: PAYROLL_ADMIN,
  super_admin: PERMISSIONS,
};

/** Roles that only holders of `role.assign` may grant or revoke. */
const PRIVILEGED_ROLES: readonly Role[] = ["hr_admin", "payroll_admin", "super_admin"];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isPrivilegedRole(role: Role): boolean {
  return PRIVILEGED_ROLES.includes(role);
}

export function permissionsForRoles(roles: readonly Role[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) for (const p of ROLE_PERMISSIONS[role]) set.add(p);
  return [...set].sort();
}

export interface PermissionHolder {
  permissions: readonly Permission[];
}

export function can(user: PermissionHolder | null | undefined, permission: Permission): boolean {
  return !!user && user.permissions.includes(permission);
}

export function canAny(user: PermissionHolder | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => can(user, p));
}
