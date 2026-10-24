import { z } from "zod";
import { ROLES } from "@/lib/auth/permissions";

export const rolesSchema = z.array(z.enum(ROLES)).max(ROLES.length);

export const createUserSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(100),
  email: z.email("Enter a valid email").transform((s) => s.trim().toLowerCase()),
  roles: rolesSchema.min(1, "Pick at least one role"),
});
