import { inArray } from "drizzle-orm";
import { dateInTimeZone } from "@/lib/dates";
import { employees } from "@/server/db/schema";
import { syncEntitlements } from "@/server/modules/leave/ledger";
import type { JobDefinition } from "./registry";

export const leaveAccrueJob: JobDefinition = {
  name: "leave:accrue",
  description: "Posts this month's leave accruals and any missing annual grants for current employees.",
  runKey: (now, timeZone) => dateInTimeZone(now, timeZone).slice(0, 7),
  run: (db, now, timeZone) => {
    const today = dateInTimeZone(now, timeZone);
    const current = db
      .select({ id: employees.id })
      .from(employees)
      .where(inArray(employees.status, ["active", "on_notice"]))
      .all();
    let granted = 0;
    let accrued = 0;
    for (const { id } of current) {
      const result = syncEntitlements(db, id, today);
      granted += result.granted;
      accrued += result.accrued;
    }
    return `Granted ${granted}, accrued ${accrued} for ${current.length} employee(s)`;
  },
};
