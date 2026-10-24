import { dateInTimeZone, startOfWeek } from "@/lib/dates";
import { remindApprovers } from "@/server/modules/timesheets/reminders";
import type { JobDefinition } from "./registry";

export const timesheetRemindApproversJob: JobDefinition = {
  name: "timesheet:remind-approvers",
  description: "Monday morning: tells managers how many submitted timesheets are waiting for their approval.",
  runKey: (now, timeZone) => startOfWeek(dateInTimeZone(now, timeZone)),
  run: (db) => {
    const { approvers, timesheets } = remindApprovers(db);
    return `Reminded ${approvers} approver(s) about ${timesheets} timesheet(s)`;
  },
};
