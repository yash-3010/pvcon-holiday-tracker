import "server-only";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig } from "@/auth.config";
import { isAllowedEmail } from "@/lib/auth/email-domain";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { createRateLimiter } from "@/server/lib/rate-limit";
import { clientIp } from "@/server/lib/request";
import { writeAudit } from "@/server/modules/audit/service";
import { getSetting } from "@/server/modules/settings/service";
import { verifyCredentials } from "@/server/modules/users/service";

class InvalidLogin extends CredentialsSignin {
  code = "invalid";
}
class AccountLocked extends CredentialsSignin {
  code = "locked";
}
class RateLimited extends CredentialsSignin {
  code = "rate_limited";
}

const loginLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 20 });

const credentialsSchema = z.object({
  email: z.email().transform((s) => s.trim().toLowerCase()),
  password: z.string().min(1).max(200),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw, request) => {
        const ip = clientIp(request.headers);
        const userAgent = request.headers.get("user-agent");
        if (!loginLimiter.check(`ip:${ip ?? "unknown"}`)) throw new RateLimited();

        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success || !isAllowedEmail(parsed.data.email, config.allowedEmailDomain)) throw new InvalidLogin();

        const security = getSetting(db, "security");
        const result = await verifyCredentials(db, parsed.data.email, parsed.data.password, {
          now: new Date(),
          lockoutAttempts: security.lockoutAttempts,
          lockoutMinutes: security.lockoutMinutes,
        });
        if (!result.ok) {
          if (result.userId) {
            writeAudit(db, {
              actorUserId: result.userId,
              action: "auth.login_failed",
              entityType: "user",
              entityId: result.userId,
              summary: `Sign-in failed (${result.reason})`,
              ip,
              userAgent,
            });
          }
          if (result.reason === "locked") throw new AccountLocked();
          throw new InvalidLogin();
        }

        writeAudit(db, {
          actorUserId: result.user.id,
          action: "auth.login",
          entityType: "user",
          entityId: result.user.id,
          summary: "Signed in",
          ip,
          userAgent,
        });
        return {
          id: String(result.user.id),
          email: result.user.email,
          name: result.user.name,
          sessionVersion: result.user.sessionVersion,
        };
      },
    }),
  ],
});
