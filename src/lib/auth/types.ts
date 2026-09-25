import type { Permission, Role } from "./permissions";

/** The authenticated user as resolved from the database on each request. */
export interface SessionUser {
  id: number;
  email: string;
  name: string;
  roles: Role[];
  permissions: Permission[];
  mustChangePassword: boolean;
  /** The linked employee record, if any. */
  employeeId: number | null;
  /** True when at least one current employee reports directly to this user's employee record. */
  hasReports: boolean;
}
