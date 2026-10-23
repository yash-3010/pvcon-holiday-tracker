import type { DbLike } from "@/server/db/client";
import { getSetting } from "@/server/modules/settings/service";

/**
 * Days of the week (0 = Sunday) the employee does not work. Phase 2 uses the company setting; Phase 3 reads the
 * employee's shift. Leave counting, the team calendar and timesheets must go through this, never the setting.
 */
export function weeklyOffsForEmployee(db: DbLike, _employeeId: number): number[] {
  return getSetting(db, "attendance").weeklyOffs;
}

/** The company default (Phase 3: the default shift's offs), for previews that are not about one employee. */
export function companyWeeklyOffs(db: DbLike): number[] {
  return getSetting(db, "attendance").weeklyOffs;
}
