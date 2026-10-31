import { and, eq, inArray } from "drizzle-orm";
import { compOffDaysFor } from "@/lib/attendance";
import { addDays, dateInTimeZone, dayOfWeek, formatDate } from "@/lib/dates";
import { WEEKDAY_LABELS } from "@/lib/leave";
import { attendanceDays, employees, users } from "@/server/db/schema";
import { fillMissingAttendance, recomputeDateForAll } from "@/server/modules/attendance/compute";
import { autoClockOut } from "@/server/modules/attendance/punches";
import { endForgottenTimers } from "@/server/modules/clock/service";
import { compOffThresholds } from "@/server/modules/compoff/service";
import { notify } from "@/server/modules/notifications/service";
import { getSetting } from "@/server/modules/settings/service";
import type { JobDefinition } from "./registry";

/** Earlier days the nightly run fills when they have no row, so a missed run or a back-dated joiner heals itself. */
const CATCH_UP_DAYS = 34;

export const attendanceCloseDayJob: JobDefinition = {
  name: "attendance:close-day",
  description:
    "Closes yesterday: clocks out anyone still clocked in (their timesheet time stops at the shift's end), computes everyone's attendance (and any of the 34 days before it still missing), and invites people who worked an off day to claim comp-off.",
  runKey: (now, timeZone) => addDays(dateInTimeZone(now, timeZone), -1),
  run: (db, now, timeZone) => {
    const yesterday = addDays(dateInTimeZone(now, timeZone), -1);
    const closed = autoClockOut(db, yesterday, now);
    endForgottenTimers(db, yesterday);
    const computed = recomputeDateForAll(db, yesterday, { now });
    const filled = fillMissingAttendance(db, addDays(yesterday, -CATCH_UP_DAYS), addDays(yesterday, -1), { now });
    let prompts = 0;
    if (getSetting(db, "compOff").enabled) {
      const worked = db
        .select({ employeeId: attendanceDays.employeeId, minutes: attendanceDays.workedMinutes, userId: employees.userId })
        .from(attendanceDays)
        .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
        .innerJoin(users, eq(users.id, employees.userId))
        .where(
          and(
            eq(attendanceDays.date, yesterday),
            eq(attendanceDays.offDayWorked, true),
            eq(users.status, "active"),
            inArray(employees.status, ["active", "on_notice"]),
          ),
        )
        .all();
      for (const w of worked) {
        if (compOffDaysFor(w.minutes, compOffThresholds(db, w.employeeId)) === 0) continue;
        notify(db, {
          userId: w.userId!,
          type: "compoff.eligible",
          title: `You worked on ${WEEKDAY_LABELS[dayOfWeek(yesterday)]} ${formatDate(yesterday, { day: "numeric", month: "short" })}: claim comp-off`,
          link: `/me/attendance?month=${yesterday.slice(0, 7)}`,
        });
        prompts += 1;
      }
    }
    return `Closed ${yesterday}: ${closed} automatic clock-out(s), ${computed} day(s) computed, ${filled} missing earlier day(s) filled, ${prompts} comp-off prompt(s)`;
  },
};
