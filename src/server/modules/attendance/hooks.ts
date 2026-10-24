import type { ISODate } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import { recomputeAttendance, recomputeDateForAll } from "./compute";

/** Called inside the transaction whenever approved leave appears or disappears for an employee's dates. */
export function onLeaveChanged(tx: DbLike, employeeId: number, from: ISODate, to: ISODate): void {
  recomputeAttendance(tx, employeeId, from, to);
}

/** Called inside the transaction when a holiday is added, moved, retyped or removed. */
export function onHolidayChanged(tx: DbLike, date: ISODate): void {
  recomputeDateForAll(tx, date);
}
