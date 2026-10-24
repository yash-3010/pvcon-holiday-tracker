import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { LeaveHalf } from "@/lib/leave";
import type { DB } from "@/server/db/client";
import {
  employees, files, leaveLedger, leaveRequests, leaveTypes, notifications, type EmployeeRow, type LeaveTypeRow,
} from "@/server/db/schema";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const hooks = vi.hoisted(() => ({ onHolidayChanged: vi.fn(), onLeaveChanged: vi.fn() }));
vi.mock("@/server/modules/attendance/hooks", () => hooks);

import { createHoliday } from "@/server/modules/holidays/service";
import { balanceOf, postLedger, syncEntitlements } from "@/server/modules/leave/ledger";
import {
  applyLeave, applyLeaveOnBehalf, approveLeave, bulkApproveLeave, canDecideLeave, cancelLeave, leaveApproverUserIds,
  quoteLeave, rejectLeave, withdrawLeave,
} from "@/server/modules/leave/requests";
import { listLeaveTypes, seedDefaultLeaveTypes, setLeaveTypeArchived } from "@/server/modules/leave/types";
import { getUserById } from "@/server/modules/users/service";

// Tuesday 20 Oct 2026. 2 Nov 2026 is a Monday.
const TODAY = "2026-10-20";

let db: DB;
let types: Record<string, LeaveTypeRow>;
let hr: SessionUser;
let manager: { employee: EmployeeRow; user: SessionUser };
let asha: { employee: EmployeeRow; user: SessionUser };

function person(name: string, overrides: Partial<typeof employees.$inferInsert> = {}, roles: ("employee" | "hr_admin")[] = ["employee"]) {
  const login = insertUser(db, { roles, name });
  const employee = insertEmployee(db, { firstName: name, lastName: "Test", dateOfJoining: "2025-01-01", userId: login.id, ...overrides });
  syncEntitlements(db, employee.id, TODAY);
  return { employee, user: sessionUserFor(db, login) };
}

beforeEach(() => {
  db = createTestDb();
  hooks.onLeaveChanged.mockClear();
  seedDefaultLeaveTypes(db);
  types = Object.fromEntries(listLeaveTypes(db).map((t) => [t.code, t]));
  hr = person("Hema", {}, ["employee", "hr_admin"]).user;
  manager = person("Ravi");
  asha = person("Asha", { reportingManagerId: manager.employee.id });
  // Reload the manager's session so it sees the direct report added after it was created.
  manager = { ...manager, user: sessionUserFor(db, getUserById(db, manager.user.id)!) };
});

function input(overrides: Partial<{ leaveTypeId: number; startDate: string; endDate: string; startHalf: LeaveHalf; endHalf: LeaveHalf; reason: string | null }> = {}) {
  return {
    leaveTypeId: types.CL.id, startDate: "2026-11-02", endDate: "2026-11-02", startHalf: "full" as LeaveHalf,
    endHalf: "full" as LeaveHalf, reason: null, ...overrides,
  };
}

const apply = (overrides: Parameters<typeof input>[0] = {}, opts: { today?: string; attachmentFileId?: number } = {}) =>
  applyLeave(db, asha.user, input(overrides), { today: opts.today ?? TODAY, attachmentFileId: opts.attachmentFileId ?? null });

const ledgerFor = (requestId: number) =>
  db
    .select({ kind: leaveLedger.kind, delta: leaveLedger.delta, year: leaveLedger.year })
    .from(leaveLedger)
    .where(and(eq(leaveLedger.refType, "leave_request"), eq(leaveLedger.refId, requestId)))
    .all();

const notified = () => db.select({ userId: notifications.userId, type: notifications.type }).from(notifications).all();

describe("quote", () => {
  it("counts days with the employee's holidays and reports the balance", () => {
    createHoliday(db, { date: "2026-11-04", name: "Holiday", type: "fixed" });
    const quote = quoteLeave(db, asha.employee.id, input({ endDate: "2026-11-06" }));
    expect(quote).toMatchObject({ days: 4, year: 2026, balance: 12, pending: 0, available: 12 });
    expect(quote.breakdown.find((d) => d.date === "2026-11-04")).toMatchObject({ counted: 0, offReason: "holiday" });
  });

  it("refuses a request across leave years", () => {
    expectDomainError(() => quoteLeave(db, asha.employee.id, input({ startDate: "2026-12-31", endDate: "2027-01-01" })), "CROSSES_LEAVE_YEAR");
  });
});

describe("applying", () => {
  it("stores the quoted days as a pending request and notifies the manager", () => {
    const request = apply({ endDate: "2026-11-03", reason: "Family function" });
    expect(request).toMatchObject({ status: "pending", days: 2, employeeId: asha.employee.id, appliedBy: asha.user.id, reason: "Family function" });
    expect(notified()).toEqual([{ userId: manager.user.id, type: "leave.submitted" }]);
  });

  it("notifies HR approvers when the manager has no login", () => {
    const loner = person("Kiran");
    db.update(employees).set({ userId: null }).where(eq(employees.id, manager.employee.id)).run();
    expect(leaveApproverUserIds(db, asha.employee.id)).toEqual([hr.id]);
    expect(leaveApproverUserIds(db, loner.employee.id)).toEqual([hr.id]);
  });

  it("never routes a request to its own applicant", () => {
    const hrEmployee = db.select().from(employees).where(eq(employees.userId, hr.id)).get()!;
    expect(leaveApproverUserIds(db, hrEmployee.id)).toEqual([]);
  });

  it.each([
    ["TYPE_UNAVAILABLE", () => { setLeaveTypeArchived(db, types.SL.id, true); return apply({ leaveTypeId: types.SL.id }); }],
    ["TYPE_NOT_APPLICABLE", () => {
      db.update(leaveTypes).set({ applicableEmploymentTypes: ["intern"] }).where(eq(leaveTypes.id, types.SL.id)).run();
      return apply({ leaveTypeId: types.SL.id });
    }],
    ["HALF_DAY_NOT_ALLOWED", () => {
      db.update(leaveTypes).set({ allowHalfDay: false }).where(eq(leaveTypes.id, types.CL.id)).run();
      return apply({ startHalf: "first_half", endHalf: "first_half" });
    }],
    ["INVALID_HALVES", () => apply({ endDate: "2026-11-03", startHalf: "first_half" })],
    ["BEFORE_JOINING", () => apply({ startDate: "2024-12-31", endDate: "2024-12-31" }, { today: "2024-12-01" })],
    ["AFTER_LAST_DAY", () => {
      db.update(employees).set({ status: "on_notice", lastWorkingDate: "2026-11-02" }).where(eq(employees.id, asha.employee.id)).run();
      return apply({ endDate: "2026-11-03" });
    }],
    ["EMPLOYEE_INACTIVE", () => {
      db.update(employees).set({ status: "exited" }).where(eq(employees.id, asha.employee.id)).run();
      return apply();
    }],
    ["CROSSES_LEAVE_YEAR", () => apply({ startDate: "2026-12-31", endDate: "2027-01-01" })],
    ["NO_WORKING_DAYS", () => apply({ startDate: "2026-11-07", endDate: "2026-11-08" })],
    ["TOO_MANY_DAYS", () => apply({ endDate: "2026-11-05" })],
    ["NOTICE_REQUIRED", () => apply({ startDate: TODAY, endDate: TODAY })],
    ["BACKDATED_NOT_ALLOWED", () => apply({ startDate: "2026-10-19", endDate: "2026-10-19" })],
    ["ATTACHMENT_REQUIRED", () => apply({ leaveTypeId: types.SL.id, endDate: "2026-11-04" })],
  ])("refuses with %s", (code, run) => {
    expectDomainError(run, code);
  });

  it("allows back-dated sick leave and long sick leave with a document", () => {
    expect(apply({ leaveTypeId: types.SL.id, startDate: "2026-10-19", endDate: "2026-10-19" }).days).toBe(1);
    const file = db.insert(files).values({ storageName: "a", originalName: "note.pdf", mime: "application/pdf", size: 1, sha256: "x" }).returning().get();
    expect(apply({ leaveTypeId: types.SL.id, endDate: "2026-11-04" }, { attachmentFileId: file.id }).attachmentFileId).toBe(file.id);
  });

  it("refuses overlaps but lets a morning and an afternoon share a day", () => {
    apply({ startHalf: "first_half", endHalf: "first_half" });
    apply({ startHalf: "second_half", endHalf: "second_half" });
    expectDomainError(() => apply(), "OVERLAP");
    expectDomainError(() => apply({ startDate: "2026-10-30", endDate: "2026-11-02", endHalf: "first_half" }), "OVERLAP");
  });

  it("counts pending requests against the balance", () => {
    postLedger(db, { employeeId: asha.employee.id, leaveTypeId: types.CL.id, year: 2026, date: TODAY, delta: -10, kind: "adjustment" });
    apply({ endDate: "2026-11-03" });
    expectDomainError(() => apply({ startDate: "2026-11-04", endDate: "2026-11-04" }), "INSUFFICIENT_BALANCE");
  });

  it("lets loss-of-pay leave go below zero", () => {
    expect(apply({ leaveTypeId: types.LWP.id, endDate: "2026-11-03" }).days).toBe(2);
  });
});

describe("deciding", () => {
  it("lets the manager approve: one debit, the attendance hook, a notice to the employee", () => {
    const request = apply({ endDate: "2026-11-03" });
    const approved = approveLeave(db, manager.user, request.id, "Enjoy");
    expect(approved).toMatchObject({ status: "approved", approverId: manager.user.id, decisionNote: "Enjoy" });
    expect(ledgerFor(request.id)).toEqual([{ kind: "taken", delta: -2, year: 2026 }]);
    expect(balanceOf(db, asha.employee.id, types.CL.id, 2026)).toBe(10);
    expect(hooks.onLeaveChanged).toHaveBeenCalledTimes(1);
    expect(hooks.onLeaveChanged.mock.calls[0]!.slice(1)).toEqual([asha.employee.id, "2026-11-02", "2026-11-03"]);
    expect(notified()).toContainEqual({ userId: asha.user.id, type: "leave.approved" });
    expectDomainError(() => approveLeave(db, manager.user, request.id, null), "NOT_PENDING");
  });

  it("re-checks the balance at approval", () => {
    const request = apply({ endDate: "2026-11-03" });
    postLedger(db, { employeeId: asha.employee.id, leaveTypeId: types.CL.id, year: 2026, date: TODAY, delta: -11, kind: "adjustment" });
    expectDomainError(() => approveLeave(db, manager.user, request.id, null), "INSUFFICIENT_BALANCE");
  });

  it("keeps decisions inside the reporting line and away from the applicant", () => {
    const peer = person("Meera");
    const request = apply();
    expect(canDecideLeave(db, peer.user, asha.employee.id)).toBe(false);
    expectDomainError(() => approveLeave(db, peer.user, request.id, null), "FORBIDDEN");
    expect(canDecideLeave(db, hr, asha.employee.id)).toBe(true);
    const hrEmployee = db.select().from(employees).where(eq(employees.userId, hr.id)).get()!;
    const own = applyLeave(db, hr, input(), { today: TODAY, attachmentFileId: null });
    expect(own.employeeId).toBe(hrEmployee.id);
    expectDomainError(() => approveLeave(db, hr, own.id, null), "SELF_APPROVAL");
  });

  it("rejects with a note and no ledger entry", () => {
    const request = apply();
    expect(rejectLeave(db, manager.user, request.id, "Release week")).toMatchObject({ status: "rejected", decisionNote: "Release week" });
    expect(ledgerFor(request.id)).toEqual([]);
    expect(notified()).toContainEqual({ userId: asha.user.id, type: "leave.rejected" });
  });

  it("approves in bulk and reports the ones that could not be approved", () => {
    const first = apply();
    const second = apply({ startDate: "2026-11-03", endDate: "2026-11-03" });
    postLedger(db, { employeeId: asha.employee.id, leaveTypeId: types.CL.id, year: 2026, date: TODAY, delta: -11, kind: "adjustment" });
    const result = bulkApproveLeave(db, manager.user, [first.id, second.id], null);
    expect(result.approved).toEqual([first.id]);
    expect(result.failed).toEqual([{ id: second.id, error: expect.stringContaining("day") }]);
    expect(db.select().from(leaveRequests).where(eq(leaveRequests.id, second.id)).get()!.status).toBe("pending");
  });
});

describe("withdrawing and cancelling", () => {
  it("lets the applicant withdraw a pending request only", () => {
    const request = apply();
    expectDomainError(() => withdrawLeave(db, manager.user, request.id), "FORBIDDEN");
    expect(withdrawLeave(db, asha.user, request.id).status).toBe("withdrawn");
    expectDomainError(() => withdrawLeave(db, asha.user, request.id), "NOT_PENDING");
  });

  it("restores exactly what the approval took", () => {
    const request = apply({ endDate: "2026-11-02", startHalf: "second_half", endHalf: "second_half" });
    approveLeave(db, manager.user, request.id, null);
    const cancelled = cancelLeave(db, asha.user, request.id, "Plans changed", { today: TODAY });
    expect(cancelled).toMatchObject({ status: "cancelled", cancelledBy: asha.user.id, cancelNote: "Plans changed" });
    expect(ledgerFor(request.id)).toEqual([
      { kind: "taken", delta: -0.5, year: 2026 },
      { kind: "cancelled", delta: 0.5, year: 2026 },
    ]);
    expect(balanceOf(db, asha.employee.id, types.CL.id, 2026)).toBe(12);
    expect(hooks.onLeaveChanged).toHaveBeenCalledTimes(2);
    expect(notified()).toContainEqual({ userId: manager.user.id, type: "leave.cancelled" });
    expectDomainError(() => cancelLeave(db, asha.user, request.id, null, { today: TODAY }), "NOT_APPROVED");
  });

  it("lets employees cancel only future leave, and HR any leave", () => {
    const request = apply();
    approveLeave(db, manager.user, request.id, null);
    expectDomainError(() => cancelLeave(db, asha.user, request.id, null, { today: "2026-11-02" }), "CANCEL_NOT_ALLOWED");
    expectDomainError(() => cancelLeave(db, manager.user, request.id, null, { today: TODAY }), "FORBIDDEN");
    expect(cancelLeave(db, hr, request.id, "Came to work", { today: "2026-11-05" }).status).toBe("cancelled");
    expect(notified()).toContainEqual({ userId: asha.user.id, type: "leave.cancelled" });
  });
});

describe("recording leave on someone's behalf", () => {
  it("is approved at once and skips notice and length limits, but not the balance", () => {
    const recorded = applyLeaveOnBehalf(db, hr, { ...input({ startDate: "2026-10-12", endDate: "2026-10-16" }), employeeId: asha.employee.id }, { today: TODAY, attachmentFileId: null });
    expect(recorded).toMatchObject({ status: "approved", approverId: hr.id, appliedBy: hr.id, days: 5 });
    expect(balanceOf(db, asha.employee.id, types.CL.id, 2026)).toBe(7);
    expect(notified()).toContainEqual({ userId: asha.user.id, type: "leave.recorded" });
    expectDomainError(
      () => applyLeaveOnBehalf(db, hr, { ...input({ startDate: "2026-11-02", endDate: "2026-11-11" }), employeeId: asha.employee.id }, { today: TODAY, attachmentFileId: null }),
      "INSUFFICIENT_BALANCE",
    );
  });

  it("cannot be used to record one's own leave", () => {
    const hrEmployee = db.select().from(employees).where(eq(employees.userId, hr.id)).get()!;
    expectDomainError(() => applyLeaveOnBehalf(db, hr, { ...input(), employeeId: hrEmployee.id }, { today: TODAY, attachmentFileId: null }), "SELF_APPROVAL");
  });
});
