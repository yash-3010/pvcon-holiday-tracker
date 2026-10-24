import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, employeeEvents, employees, notifications } from "@/server/db/schema";
import { runJobByName } from "@/server/jobs/registry";
import { listEmployeeChecklists, seedDefaultChecklistTemplates } from "@/server/modules/employees/checklists";
import { recordResignation, sendProbationReminders, withdrawResignation } from "@/server/modules/employees/lifecycle";
import { createEmployee } from "@/server/modules/employees/service";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { employeeInput, insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const none = { login: { mode: "none" as const }, onboarding: false };
let db: DB;
let hr: SessionUser;
const employee = (id: number) => db.select().from(employees).where(eq(employees.id, id)).get()!;

beforeEach(() => {
  db = createTestDb();
  hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
  seedDefaultChecklistTemplates(db);
});

describe("resignation", () => {
  it("puts an active employee on notice with an event and an offboarding checklist", () => {
    const row = createEmployee(db, hr, employeeInput(), none);
    const after = recordResignation(db, hr.id, row.id, { resignationDate: "2026-11-01", lastWorkingDate: "2026-11-30", exitReason: "Relocating" });
    expect(after).toMatchObject({ status: "on_notice", resignationDate: "2026-11-01", lastWorkingDate: "2026-11-30", exitReason: "Relocating" });
    const resigned = db.select().from(employeeEvents).where(eq(employeeEvents.type, "resigned")).get();
    expect(resigned).toMatchObject({ effectiveDate: "2026-11-01", to: { status: "on_notice", lastWorkingDate: "2026-11-30" } });
    expect(listEmployeeChecklists(db, row.id).map((c) => c.kind)).toEqual(["offboarding"]);
  });

  it("accepts only active employees and a last working day on or after the resignation date", () => {
    const row = createEmployee(db, hr, employeeInput(), none);
    expectDomainError(() => recordResignation(db, hr.id, row.id, { resignationDate: "2026-11-10", lastWorkingDate: "2026-11-01", exitReason: null }), "INVALID_DATES");
    recordResignation(db, hr.id, row.id, { resignationDate: "2026-11-01", lastWorkingDate: "2026-11-30", exitReason: null });
    expectDomainError(() => recordResignation(db, hr.id, row.id, { resignationDate: "2026-11-01", lastWorkingDate: "2026-11-30", exitReason: null }), "NOT_ACTIVE");
  });

  it("withdrawal restores active status and cancels the open offboarding checklist", () => {
    const row = createEmployee(db, hr, employeeInput(), none);
    expectDomainError(() => withdrawResignation(db, row.id), "NOT_ON_NOTICE");
    recordResignation(db, hr.id, row.id, { resignationDate: "2026-11-01", lastWorkingDate: "2026-11-30", exitReason: "x" });
    expect(withdrawResignation(db, row.id)).toMatchObject({ status: "active", resignationDate: null, lastWorkingDate: null, exitReason: null });
    expect(listEmployeeChecklists(db, row.id).map((c) => c.status)).toEqual(["cancelled"]);
  });
});

describe("employee:lifecycle job", () => {
  // 19:00 UTC on 1 Oct is 00:30 on 2 Oct in Asia/Kolkata (the company default time zone).
  const at = new Date("2026-10-01T19:00:00Z");

  it("exits employees the day after their last working day in the company time zone, once", () => {
    const user = insertUser(db, { roles: ["employee"] });
    const leaving = insertEmployee(db, { status: "on_notice", lastWorkingDate: "2026-10-01", userId: user.id });
    const staying = insertEmployee(db, { status: "on_notice", lastWorkingDate: "2026-10-02" });

    expect(runJobByName(db, "employee:lifecycle", at)).toMatchObject({
      status: "succeeded",
      detail: "Exited 1 employee(s); sent 0 probation reminder(s)",
    });
    expect(employee(leaving.id).status).toBe("exited");
    expect(employee(staying.id).status).toBe("on_notice");
    expect(getUserById(db, user.id)).toMatchObject({ status: "disabled", sessionVersion: user.sessionVersion + 1 });
    expect(db.select().from(employeeEvents).where(eq(employeeEvents.employeeId, leaving.id)).get()).toMatchObject({
      type: "exited", effectiveDate: "2026-10-01",
    });
    expect(db.select().from(auditLogs).where(eq(auditLogs.action, "employee.exit")).all()).toHaveLength(1);
    expect(runJobByName(db, "employee:lifecycle", at).status).toBe("skipped");
  });

  it("keeps the login of the last active super admin", () => {
    const root = insertUser(db, { roles: ["super_admin"] });
    insertEmployee(db, { status: "on_notice", lastWorkingDate: "2026-09-30", userId: root.id });
    runJobByName(db, "employee:lifecycle", at);
    expect(getUserById(db, root.id)!.status).toBe("active");
  });

  it("reminds HR once about probations ending within a week", () => {
    const due = insertEmployee(db, { firstName: "Asha", lastName: "Rao", probationEndDate: "2026-10-05" });
    insertEmployee(db, { probationEndDate: "2026-10-20" });
    insertEmployee(db, { probationEndDate: "2026-10-04", confirmationDate: "2026-10-01" });
    insertEmployee(db, { probationEndDate: "2026-10-01" });

    expect(sendProbationReminders(db, "2026-10-02")).toBe(1);
    expect(sendProbationReminders(db, "2026-10-02")).toBe(0);
    const sent = db.select().from(notifications).all();
    expect(sent.map((n) => n.userId)).toEqual([hr.id]);
    expect(sent[0]).toMatchObject({ type: "employee.probation_due", link: `/org/employees/${due.id}?tab=job` });
    expect(sent[0]!.title).toContain("Asha Rao");
  });
});
