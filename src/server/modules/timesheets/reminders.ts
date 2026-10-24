import { and, eq, inArray } from "drizzle-orm";
import { addDays, formatDate, startOfWeek, type ISODate } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import { employees, timesheets, users } from "@/server/db/schema";
import { approverUserIdsFor, TIMESHEET_APPROVAL } from "@/server/modules/approvals/routing";
import { notify } from "@/server/modules/notifications/service";
import { availableMinutes } from "./availability";

/**
 * Friday reminder (spec §5.3): current employees with an active login whose week is neither submitted nor approved,
 * unless the week offered them no working hours. Returns how many were reminded.
 */
export function remindEmployees(db: DbLike, today: ISODate): number {
  const weekStart = startOfWeek(today);
  const closed = new Set(
    db
      .select({ employeeId: timesheets.employeeId })
      .from(timesheets)
      .where(and(eq(timesheets.weekStart, weekStart), inArray(timesheets.status, ["submitted", "approved"])))
      .all()
      .map((r) => r.employeeId),
  );
  const people = db
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(and(inArray(employees.status, ["active", "on_notice"]), eq(users.status, "active")))
    .all();
  let reminded = 0;
  for (const p of people) {
    if (closed.has(p.id) || availableMinutes(db, p.id, weekStart, addDays(weekStart, 6)) === 0) continue;
    notify(db, {
      userId: p.userId!,
      type: "timesheet.reminder",
      title: `Please fill in and submit your timesheet for the week of ${formatDate(weekStart, { day: "numeric", month: "short" })}`,
      link: `/me/timesheets/${weekStart}`,
    });
    reminded += 1;
  }
  return reminded;
}

/** Monday reminder: one notification per approver with the number of submitted timesheets waiting for them. */
export function remindApprovers(db: DbLike): { approvers: number; timesheets: number } {
  const waiting = db.select({ employeeId: timesheets.employeeId }).from(timesheets).where(eq(timesheets.status, "submitted")).all();
  const perApprover = new Map<number, number>();
  let covered = 0;
  for (const { employeeId } of waiting) {
    const approvers = approverUserIdsFor(db, employeeId, TIMESHEET_APPROVAL);
    if (approvers.length) covered += 1;
    for (const userId of approvers) perApprover.set(userId, (perApprover.get(userId) ?? 0) + 1);
  }
  for (const [userId, n] of perApprover) {
    notify(db, {
      userId,
      type: "timesheet.pending",
      title: n === 1 ? "1 timesheet is waiting for your approval" : `${n} timesheets are waiting for your approval`,
      link: "/approvals?tab=timesheets",
    });
  }
  return { approvers: perApprover.size, timesheets: covered };
}
