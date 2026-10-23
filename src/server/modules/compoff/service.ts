import type { DbLike } from "@/server/db/client";
import { shiftForEmployee } from "@/server/modules/attendance/shifts";
import { getSetting } from "@/server/modules/settings/service";

/** Minutes of off-day work for a half and a full comp-off day: the settings, or the employee's shift (spec §5.5). */
export function compOffThresholds(db: DbLike, employeeId: number): { half: number; full: number } {
  const settings = getSetting(db, "compOff");
  const shift = shiftForEmployee(db, employeeId);
  return { half: settings.halfDayMinutes ?? shift.halfDayMinutes, full: settings.fullDayMinutes ?? shift.fullDayMinutes };
}
