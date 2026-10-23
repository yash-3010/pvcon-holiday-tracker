import { and, eq, gte, lte } from "drizzle-orm";
import type { ISODate } from "@/lib/dates";
import { leaveYearOf, leaveYearRange } from "@/lib/leave";
import type { ApplyLeaveContext } from "@/components/leave/apply-leave-sheet";
import type { DbLike } from "@/server/db/client";
import { holidays, type EmployeeRow } from "@/server/db/schema";
import { companyWeeklyOffs, weeklyOffsForEmployee } from "@/server/modules/attendance/calendar";
import { holidaysForEmployee } from "@/server/modules/holidays/service";
import { compOffAvailable } from "@/server/modules/compoff/service";
import { getSetting } from "@/server/modules/settings/service";
import { balancesFor, leaveYearStartMonth } from "./ledger";
import { isApplicable, listLeaveTypes } from "./types";

/**
 * What the apply sheet needs to preview a request: the types on offer, what is available this leave year and next,
 * and the weekly offs and holidays the day count skips. With no employee (HR recording leave) it previews with the
 * company weekly offs and fixed holidays; the server applies the employee's own calendar on save.
 */
export function applyLeaveContext(db: DbLike, employee: EmployeeRow | null, today: ISODate): ApplyLeaveContext {
  const startMonth = leaveYearStartMonth(db);
  const year = leaveYearOf(today, startMonth);
  const from = leaveYearRange(year, startMonth).start;
  const to = leaveYearRange(year + 1, startMonth).end;
  const compOffEnabled = getSetting(db, "compOff").enabled;
  const types = listLeaveTypes(db)
    .filter((t) => (employee ? isApplicable(t, employee.employmentType) : true) && (!t.isCompOff || compOffEnabled))
    .map((t) => ({
      id: t.id, code: t.code, name: t.name, allowHalfDay: t.allowHalfDay, allowNegative: t.allowNegative,
      countWeekends: t.countWeekends, attachmentAfterDays: t.attachmentAfterDays, minNoticeDays: t.minNoticeDays,
      maxConsecutiveDays: t.maxConsecutiveDays,
    }));
  const available: ApplyLeaveContext["available"] = {};
  if (employee) {
    // Comp-off is what its lots still hold today, not the ledger (spec §5.5).
    const compOff = compOffAvailable(db, employee.id, today);
    for (const y of [year, year + 1]) {
      available[y] = Object.fromEntries(
        balancesFor(db, employee.id, y).map((b) => [b.type.id, b.type.isCompOff ? compOff - b.pending : b.available]),
      );
    }
  }
  return {
    types,
    available,
    weeklyOffs: employee ? weeklyOffsForEmployee(db, employee.id) : companyWeeklyOffs(db),
    holidays: employee
      ? holidaysForEmployee(db, employee.id, from, to).map(({ date, name }) => ({ date, name }))
      : db
          .select({ date: holidays.date, name: holidays.name })
          .from(holidays)
          .where(and(eq(holidays.type, "fixed"), gte(holidays.date, from), lte(holidays.date, to)))
          .all(),
    today,
    leaveYearStartMonth: startMonth,
  };
}
