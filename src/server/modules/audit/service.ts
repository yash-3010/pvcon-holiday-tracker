import { and, count, desc, eq, gte, like, lt, type SQL } from "drizzle-orm";
import { addDays } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import { auditLogs, users } from "@/server/db/schema";

export interface AuditEntry {
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  summary: string;
  diff?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

const REDACT = /password|secret|token|Enc$|_enc$/i;

/** Field-level diff for audit entries. Skips `updatedAt`, redacts secrets, returns null when nothing changed. */
export function diffObjects(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, { from: unknown; to: unknown }> | null {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    if (key === "updatedAt") continue;
    const a = before?.[key];
    const b = after?.[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out[key] = REDACT.test(key) ? { from: "[redacted]", to: "[redacted]" } : { from: a ?? null, to: b ?? null };
  }
  return Object.keys(out).length ? out : null;
}

export function writeAudit(db: DbLike, entry: AuditEntry): void {
  db.insert(auditLogs)
    .values({
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId == null ? null : String(entry.entityId),
      summary: entry.summary,
      diff: entry.diff ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    })
    .run();
}

export interface AuditFilters {
  actorUserId?: number;
  entityType?: string;
  entityId?: string;
  actionPrefix?: string;
  /** Inclusive `YYYY-MM-DD` (UTC). */
  from?: string;
  /** Inclusive `YYYY-MM-DD` (UTC). */
  to?: string;
  page?: number;
  pageSize?: number;
}

export function listAudit(db: DbLike, filters: AuditFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
  const conditions: SQL[] = [];
  if (filters.actorUserId) conditions.push(eq(auditLogs.actorUserId, filters.actorUserId));
  if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
  if (filters.entityId) conditions.push(eq(auditLogs.entityId, filters.entityId));
  if (filters.actionPrefix) conditions.push(like(auditLogs.action, `${filters.actionPrefix}%`));
  if (filters.from) conditions.push(gte(auditLogs.at, filters.from));
  if (filters.to) conditions.push(lt(auditLogs.at, addDays(filters.to, 1)));
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = db
    .select({
      id: auditLogs.id,
      at: auditLogs.at,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      summary: auditLogs.summary,
      diff: auditLogs.diff,
      ip: auditLogs.ip,
      userAgent: auditLogs.userAgent,
      actorUserId: auditLogs.actorUserId,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(where)
    .orderBy(desc(auditLogs.at), desc(auditLogs.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();
  const total = db.select({ n: count() }).from(auditLogs).where(where).get()?.n ?? 0;
  return { rows, total, page, pageSize };
}
