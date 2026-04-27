import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authConfig } from "@/auth.config";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "admin" | "employee";
      mustChangePassword: boolean;
      name: string;
      email: string;
    } & DefaultSession["user"];
  }
}

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? "pvcon.in";

const credSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase()),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = credSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;
        if (!email.endsWith("@" + ALLOWED_DOMAIN)) return null;

        const found = await db.select().from(users).where(eq(users.email, email)).limit(1);
        const u = found[0];
        if (!u || !u.active) return null;

        const ok = await bcrypt.compare(password, u.passwordHash);
        if (!ok) return null;

        return {
          id: String(u.id),
          email: u.email,
          name: u.name,
          role: u.role,
          mustChangePassword: u.mustChangePassword,
        } as never;
      },
    }),
  ],
});
