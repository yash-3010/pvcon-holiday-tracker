import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { holidaySelections, holidays, leaveLedger, leaveTypes, users } from "@/server/db/schema";
import { balanceOf } from "@/server/modules/leave/ledger";
import type { MigrationMap } from "./migrate";
import { legacyBalance, legacyYearsFor, type LegacyBalance, type LegacySource } from "./source";

export interface Mismatch {
  email: string;
  year: number;
  field: keyof LegacyBalance;
  legacy: number;
  migrated: number;
}

/** Spec §8 step 8: every migrated employee/year must show the balances the old app showed. */
export function verifyMigration(source: LegacySource, db: DbLike, map: MigrationMap): Mismatch[] {
  const typeId = (code: string) => db.select({ id: leaveTypes.id }).from(leaveTypes).where(eq(leaveTypes.code, code)).get()!.id;
  const CL = typeId("CL");
  const SL = typeId("SL");
  const LWP = typeId("LWP");
  const mismatches: Mismatch[] = [];

  for (const user of source.users) {
    const ids = map.get(user.id);
    if (!ids?.employeeId) continue;
    const employeeId = ids.employeeId;
    const email = db.select({ email: users.email }).from(users).where(eq(users.id, ids.userId)).get()!.email;
    for (const year of legacyYearsFor(source, user)) {
      const lwpUsed =
        db
          .select({ total: sql<number>`coalesce(-sum(${leaveLedger.delta}), 0)` })
          .from(leaveLedger)
          .where(
            and(
              eq(leaveLedger.employeeId, employeeId),
              eq(leaveLedger.leaveTypeId, LWP),
              eq(leaveLedger.year, year),
              inArray(leaveLedger.kind, ["taken", "cancelled"]),
            ),
          )
          .get()?.total ?? 0;
      const optionalUsed =
        db
          .select({ n: sql<number>`count(*)` })
          .from(holidaySelections)
          .innerJoin(holidays, eq(holidays.id, holidaySelections.holidayId))
          .where(and(eq(holidaySelections.employeeId, employeeId), eq(holidays.year, year), eq(holidays.type, "optional")))
          .get()?.n ?? 0;
      const migrated: LegacyBalance = {
        casualBalance: balanceOf(db, employeeId, CL, year),
        sickBalance: balanceOf(db, employeeId, SL, year),
        unpaidUsed: lwpUsed,
        optionalUsed,
      };
      const legacy = legacyBalance(source, user.id, year);
      for (const field of Object.keys(legacy) as (keyof LegacyBalance)[]) {
        if (Math.abs(legacy[field] - migrated[field]) > 1e-9) {
          mismatches.push({ email, year, field, legacy: legacy[field], migrated: migrated[field] });
        }
      }
    }
  }
  return mismatches;
}
