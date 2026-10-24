import { dateInTimeZone } from "@/lib/dates";
import { processExits, sendProbationReminders } from "@/server/modules/employees/lifecycle";
import type { JobDefinition } from "./registry";

export const employeeLifecycleJob: JobDefinition = {
  name: "employee:lifecycle",
  description:
    "Marks employees whose last working day has passed as exited (disabling their login) and reminds HR about probations ending within 7 days.",
  runKey: (now, timeZone) => dateInTimeZone(now, timeZone),
  run: (db, now, timeZone) => {
    const today = dateInTimeZone(now, timeZone);
    const exits = processExits(db, today);
    const reminders = sendProbationReminders(db, today);
    return `Exited ${exits.length} employee(s); sent ${reminders} probation reminder(s)`;
  },
};
