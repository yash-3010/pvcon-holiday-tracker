import { dateInTimeZone, formatDate, startOfWeek } from "@/lib/dates";
import { remindEmployees } from "@/server/modules/timesheets/reminders";
import type { JobDefinition } from "./registry";

export const timesheetRemindEmployeesJob: JobDefinition = {
  name: "timesheet:remind-employees",
  description: "Friday afternoon: reminds employees to fill in and submit this week's timesheet.",
  runKey: (now, timeZone) => startOfWeek(dateInTimeZone(now, timeZone)),
  run: (db, now, timeZone) => {
    const today = dateInTimeZone(now, timeZone);
    const reminded = remindEmployees(db, today);
    return `Reminded ${reminded} employee(s) about the week of ${formatDate(startOfWeek(today), { day: "numeric", month: "short" })}`;
  },
};
