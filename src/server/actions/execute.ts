import { randomBytes } from "node:crypto";
import { z } from "zod";
import { can, type Permission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DB, DbLike } from "@/server/db/client";
import { DomainError } from "@/server/errors";
import { logger } from "@/server/lib/logger";
import { writeAudit, type AuditEntry } from "@/server/modules/audit/service";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]> };

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface ActionContext {
  tx: DbLike;
  user: SessionUser;
  audit: (entry: Omit<AuditEntry, "actorUserId" | "ip" | "userAgent">) => void;
}

export interface ActionDef<S extends z.ZodType, P, T> {
  /** Used in logs, e.g. `settings.company.update`. */
  name: string;
  schema: S;
  /** A permission, or a predicate for scope checks that need the parsed input. */
  permission?: Permission | ((user: SessionUser, input: z.output<S>) => boolean);
  /** Async work that must happen outside the transaction (hashing, reading uploads). */
  prepare?: (input: z.output<S>, user: SessionUser) => Promise<P>;
  /** Synchronous; runs inside a SQLite transaction. Must not return a promise. */
  handler: (ctx: ActionContext, input: z.output<S>, prepared: P) => T;
}

function fail(code: string, error: string): ActionResult<never> {
  return { ok: false, code, error };
}

export async function executeAction<S extends z.ZodType, P, T>(
  db: DB,
  user: SessionUser | null,
  def: ActionDef<S, P, T>,
  raw: unknown,
  meta: RequestMeta = {},
): Promise<ActionResult<T>> {
  if (!user) return fail("UNAUTHENTICATED", "Your session has expired. Please sign in again.");
  // Pages redirect these users to /change-password; actions must not run with an admin-issued temporary password.
  if (user.mustChangePassword) return fail("PASSWORD_CHANGE_REQUIRED", "Change your password before continuing.");

  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: "VALIDATION",
      error: "Please correct the highlighted fields.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }
  const input = parsed.data;

  if (def.permission) {
    const allowed =
      typeof def.permission === "function" ? def.permission(user, input) : can(user, def.permission);
    if (!allowed) return fail("FORBIDDEN", "You don't have permission to do this.");
  }

  try {
    const prepared = def.prepare ? await def.prepare(input, user) : (undefined as P);
    const data = db.transaction((tx) =>
      def.handler(
        {
          tx,
          user,
          audit: (entry) =>
            writeAudit(tx, { ...entry, actorUserId: user.id, ip: meta.ip ?? null, userAgent: meta.userAgent ?? null }),
        },
        input,
        prepared,
      ),
    );
    return { ok: true, data };
  } catch (err) {
    if (err instanceof DomainError) {
      return { ok: false, code: err.code, error: err.message, fieldErrors: err.fieldErrors };
    }
    // The reference lets an administrator find this failure in the logs.
    const requestId = randomBytes(4).toString("hex");
    logger.error({ err, action: def.name, userId: user.id, requestId }, "action failed");
    return fail("INTERNAL", `Something went wrong. Please try again. (Reference ${requestId})`);
  }
}
