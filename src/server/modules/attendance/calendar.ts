import type { DbLike } from "@/server/db/client";
import { defaultShift, shiftForEmployee } from "./shifts";

/**
 * Days of the week (0 = Sunday) the employee does not work: their shift's, or the default shift's. Leave counting, the
 * team calendar and timesheets go through this, never through shifts or settings directly.
 */
export function weeklyOffsForEmployee(db: DbLike, employeeId: number): number[] {
  return shiftForEmployee(db, employeeId).weeklyOffs;
}

/** The default shift's weekly offs, for previews that are not about one employee. */
export function companyWeeklyOffs(db: DbLike): number[] {
  return defaultShift(db).weeklyOffs;
}
