import { formatHm, minutesInZone } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import { getSetting } from "@/server/modules/settings/service";
import { clockState } from "./punches";
import { shiftForEmployee } from "./shifts";

/** Props for the clock card (dashboard and My attendance), read at `now`. */
export function clockCardFor(db: DbLike, employeeId: number, now: Date) {
  const timeZone = getSetting(db, "locale").timezone;
  const clock = clockState(db, employeeId, now);
  const shift = shiftForEmployee(db, employeeId);
  return {
    state: clock.state,
    sinceLabel: clock.since ? formatHm(minutesInZone(new Date(clock.since), timeZone)) : null,
    workMode: clock.workMode,
    workedMinutes: clock.todayWorkedMinutes,
    renderedAt: now.getTime(),
    shift: { name: shift.name, times: `${shift.startTime}–${shift.endTime}`, auto: shift.attendanceMode === "auto" },
  };
}
