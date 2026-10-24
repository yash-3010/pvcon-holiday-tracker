import { eq, inArray } from "drizzle-orm";
import { dateInTimeZone } from "@/lib/dates";
import { leaveYearOf } from "@/lib/leave";
import { employees, leaveLedger } from "@/server/db/schema";
import { closeLeaveYear, leaveYearStartMonth, syncEntitlements } from "@/server/modules/leave/ledger";
import type { JobDefinition } from "./registry";

export const leaveYearEndJob: JobDefinition = {
  name: "leave:year-end",
  description:
    "Closes the previous leave year (carry forward up to each type's cap, lapse the rest) and grants the new year's leave.",
  // The run key is the leave year being closed, so a late run still closes it exactly once.
  runKey: (now, timeZone, db) => String(leaveYearOf(dateInTimeZone(now, timeZone), leaveYearStartMonth(db)) - 1),
  run: (db, now, timeZone) => {
    const today = dateInTimeZone(now, timeZone);
    const closing = leaveYearOf(today, leaveYearStartMonth(db)) - 1;
    const withEntries = db
      .selectDistinct({ id: leaveLedger.employeeId })
      .from(leaveLedger)
      .where(eq(leaveLedger.year, closing))
      .all();
    let carried = 0;
    let lapsed = 0;
    for (const { id } of withEntries) {
      const result = closeLeaveYear(db, id, closing);
      carried += result.carried;
      lapsed += result.lapsed;
    }
    const current = db.select({ id: employees.id }).from(employees).where(inArray(employees.status, ["active", "on_notice"])).all();
    for (const { id } of current) syncEntitlements(db, id, today);
    return `Closed leave year ${closing} for ${withEntries.length} employee(s): carried ${carried} day(s), lapsed ${lapsed} day(s)`;
  },
};
