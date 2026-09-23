import { text } from "drizzle-orm/sqlite-core";

export const nowIso = () => new Date().toISOString();

/** `created_at` / `updated_at` as ISO-8601 UTC strings. Call once per table. */
export function timestamps() {
  return {
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at").notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
  };
}
