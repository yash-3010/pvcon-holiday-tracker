import type { ISODate } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";

/**
 * Called inside the transaction whenever approved leave appears or disappears for an employee's dates.
 * A no-op until Phase 3, which recomputes `attendance_days` for the range.
 */
export function onLeaveChanged(_tx: DbLike, _employeeId: number, _from: ISODate, _to: ISODate): void {}

/** Called inside the transaction when a holiday is added, moved, retyped or removed. Phase 3 recomputes that date. */
export function onHolidayChanged(_tx: DbLike, _date: ISODate): void {}
