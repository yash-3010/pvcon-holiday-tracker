import type { Permission, Role } from "./permissions";

/** The authenticated user as resolved from the database on each request. */
export interface SessionUser {
  id: number;
  email: string;
  name: string;
  roles: Role[];
  permissions: Permission[];
  mustChangePassword: boolean;
}
