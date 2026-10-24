import { and, eq, gte, isNotNull, isNull, lt, lte } from "drizzle-orm";
import { addDays, formatDate, type ISODate } from "@/lib/dates";
import type { ResignationInput } from "@/lib/validation/employees";
import type { DbLike } from "@/server/db/client";
import { employees, notifications, type EmployeeRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyMany } from "@/server/modules/notifications/service";
import { activeUserIdsWithPermission, deactivateUserForExit, type ExitLoginOutcome } from "@/server/modules/users/service";
import { cancelOpenChecklists, instantiateChecklist } from "./checklists";
import { recordEmployeeEvent, requireEmployee } from "./service";

/** Resignation → `on_notice` with a `resigned` event and the offboarding checklist (spec §5.1). */
export function recordResignation(db: DbLike, actorUserId: number, employeeId: number, input: ResignationInput): EmployeeRow {
  const before = requireEmployee(db, employeeId);
  if (before.status !== "active") throw new DomainError("NOT_ACTIVE", "Only active employees can resign.");
  if (input.lastWorkingDate < input.resignationDate) {
    throw new DomainError("INVALID_DATES", "The last working day can't be before the resignation date.", {
      lastWorkingDate: ["Must be on or after the resignation date"],
    });
  }
  const after = db
    .update(employees)
    .set({
      status: "on_notice",
      resignationDate: input.resignationDate,
      lastWorkingDate: input.lastWorkingDate,
      exitReason: input.exitReason,
    })
    .where(eq(employees.id, employeeId))
    .returning()
    .get()!;
  recordEmployeeEvent(db, {
    employeeId,
    type: "resigned",
    effectiveDate: input.resignationDate,
    from: { status: "active" },
    to: { status: "on_notice", lastWorkingDate: input.lastWorkingDate },
    note: input.exitReason,
    createdBy: actorUserId,
  });
  instantiateChecklist(db, employeeId, "offboarding");
  return after;
}

/** Undo for a resignation recorded by mistake or withdrawn by the employee. */
export function withdrawResignation(db: DbLike, employeeId: number): EmployeeRow {
  const before = requireEmployee(db, employeeId);
  if (before.status !== "on_notice") throw new DomainError("NOT_ON_NOTICE", "This employee has no pending resignation.");
  const after = db
    .update(employees)
    .set({ status: "active", resignationDate: null, lastWorkingDate: null, exitReason: null })
    .where(eq(employees.id, employeeId))
    .returning()
    .get()!;
  cancelOpenChecklists(db, employeeId, "offboarding");
  return after;
}

export interface ExitOutcome {
  employeeId: number;
  employeeCode: string;
  login: ExitLoginOutcome | "none";
}

/** Exits everyone whose last working day is before `today` (so the exit lands on LWD + 1) and disables their login. */
export function processExits(db: DbLike, today: ISODate): ExitOutcome[] {
  const due = db
    .select()
    .from(employees)
    .where(and(eq(employees.status, "on_notice"), isNotNull(employees.lastWorkingDate), lt(employees.lastWorkingDate, today)))
    .all();
  return due.map((e) => {
    db.update(employees).set({ status: "exited" }).where(eq(employees.id, e.id)).run();
    recordEmployeeEvent(db, {
      employeeId: e.id,
      type: "exited",
      effectiveDate: e.lastWorkingDate!,
      from: { status: "on_notice" },
      to: { status: "exited" },
      note: e.exitReason,
      createdBy: null,
    });
    const login = e.userId === null ? "none" : deactivateUserForExit(db, e.userId);
    writeAudit(db, {
      actorUserId: null,
      action: "employee.exit",
      entityType: "employee",
      entityId: e.id,
      summary: `${e.employeeCode} exited after last working day ${e.lastWorkingDate}; login: ${login}`,
    });
    return { employeeId: e.id, employeeCode: e.employeeCode, login };
  });
}

/** Notifies HR once per employee and probation end date, when probation ends within the next 7 days. */
export function sendProbationReminders(db: DbLike, today: ISODate): number {
  const due = db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.status, "active"),
        isNull(employees.confirmationDate),
        isNotNull(employees.probationEndDate),
        gte(employees.probationEndDate, today),
        lte(employees.probationEndDate, addDays(today, 7)),
      ),
    )
    .all();
  if (due.length === 0) return 0;
  const recipients = activeUserIdsWithPermission(db, "employee.update");
  let sent = 0;
  for (const e of due) {
    const link = `/org/employees/${e.id}?tab=job`;
    const title = `Probation ends ${formatDate(e.probationEndDate!)} for ${e.displayName}`;
    const already = db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.type, "employee.probation_due"), eq(notifications.link, link), eq(notifications.title, title)))
      .get();
    if (already) continue;
    notifyMany(db, recipients, { type: "employee.probation_due", title, body: "Confirm the employee or extend their probation.", link });
    sent += 1;
  }
  return sent;
}
