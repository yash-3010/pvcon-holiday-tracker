import "server-only";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import type { SessionUser } from "@/lib/auth/types";
import { getCurrentUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { logger } from "@/server/lib/logger";
import { clientIp } from "@/server/lib/request";
import { executeAction, type ActionDef, type ActionResult } from "./execute";

export type { ActionResult } from "./execute";

/**
 * Creates a server action. Export the result from a `"use server"` file:
 *   export const saveThing = defineAction({ name, schema, permission, handler });
 * The return value must be serializable.
 */
export function defineAction<S extends z.ZodType, P, T>(
  def: ActionDef<S, P, T> & {
    /** Paths to revalidate after success. */
    revalidate?: string[];
    /** Async side effects after commit (emails). Failures are logged, not returned. */
    after?: (data: T, user: SessionUser) => Promise<void>;
  },
) {
  return async function action(raw: z.input<S>): Promise<ActionResult<T>> {
    const user = await getCurrentUser();
    const h = await headers();
    const result = await executeAction(db, user, def, raw, { ip: clientIp(h), userAgent: h.get("user-agent") });
    if (result.ok) {
      for (const path of def.revalidate ?? []) revalidatePath(path);
      if (def.after && user) {
        try {
          await def.after(result.data, user);
        } catch (err) {
          logger.error({ err, action: def.name }, "after hook failed");
        }
      }
    }
    return result;
  };
}
