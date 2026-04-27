import type { NextAuthConfig } from "next-auth";

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt: async ({ token, user, trigger, session }) => {
      if (user) {
        const u = user as { id?: string; role?: "admin" | "employee"; mustChangePassword?: boolean };
        if (u.id) token.id = u.id;
        if (u.role) token.role = u.role;
        if (typeof u.mustChangePassword === "boolean") token.mustChangePassword = u.mustChangePassword;
      }
      if (trigger === "update" && session?.mustChangePassword === false) {
        token.mustChangePassword = false;
      }
      return token;
    },
    session: ({ session, token }) => {
      const t = token as { id?: string; role?: "admin" | "employee"; mustChangePassword?: boolean };
      if (t.id) session.user.id = t.id;
      if (t.role) session.user.role = t.role;
      session.user.mustChangePassword = !!t.mustChangePassword;
      return session;
    },
  },
};
