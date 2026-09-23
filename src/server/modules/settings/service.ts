import { eq } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import { companySettings } from "@/server/db/schema";
import { SETTINGS, type SettingsKey, type SettingsValue } from "@/lib/validation/settings";

export function getSetting<K extends SettingsKey>(db: DbLike, key: K): SettingsValue<K> {
  const def = SETTINGS[key];
  const row = db
    .select({ value: companySettings.value })
    .from(companySettings)
    .where(eq(companySettings.key, key))
    .get();
  const stored =
    row && typeof row.value === "object" && row.value !== null ? (row.value as Record<string, unknown>) : {};
  const parsed = def.schema.safeParse({ ...(def.defaults as object), ...stored });
  return (parsed.success ? parsed.data : def.defaults) as SettingsValue<K>;
}

/** Replaces the whole value. Throws a ZodError when invalid. */
export function updateSetting<K extends SettingsKey>(
  db: DbLike,
  key: K,
  value: unknown,
  actorUserId: number | null,
): { before: SettingsValue<K>; after: SettingsValue<K> } {
  const before = getSetting(db, key);
  const after = SETTINGS[key].schema.parse(value) as SettingsValue<K>;
  db.insert(companySettings)
    .values({ key, value: after, updatedBy: actorUserId })
    .onConflictDoUpdate({
      target: companySettings.key,
      set: { value: after, updatedBy: actorUserId, updatedAt: nowIso() },
    })
    .run();
  return { before, after };
}

/** Merges `partial` into the current value, then validates and saves. */
export function patchSetting<K extends SettingsKey>(
  db: DbLike,
  key: K,
  partial: Partial<SettingsValue<K>>,
  actorUserId: number | null,
) {
  const current = getSetting(db, key);
  return updateSetting(db, key, { ...(current as object), ...(partial as object) }, actorUserId);
}
