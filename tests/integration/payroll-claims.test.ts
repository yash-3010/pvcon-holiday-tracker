import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { ClaimInput } from "@/lib/validation/payroll";
import type { DB } from "@/server/db/client";
import { files, notifications, type EmployeeRow } from "@/server/db/schema";
import { canAccessFile } from "@/server/modules/files/access";
import {
  approveClaim, deleteClaim, rejectClaim, saveClaim, submitClaim, withdrawClaim,
} from "@/server/modules/payroll/claims";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const TODAY = { today: "2026-11-10", now: new Date("2026-11-10T06:00:00Z") };
let db: DB;
type Person = { employee: EmployeeRow; user: SessionUser };
let hr: Person, payroll: Person, ravi: Person, asha: Person, kiran: Person;

function person(name: string, overrides: Partial<EmployeeRow> = {}, roles: ("employee" | "hr_admin" | "payroll_admin")[] = ["employee"]): Person {
  const login = insertUser(db, { roles, name });
  const employee = insertEmployee(db, { firstName: name, lastName: "Test", dateOfJoining: "2025-01-01", userId: login.id, ...overrides });
  return { employee, user: sessionUserFor(db, login) };
}
const reload = (p: Person): Person => ({ ...p, user: sessionUserFor(db, getUserById(db, p.user.id)!) });
const claim = (overrides: Partial<ClaimInput> = {}): ClaimInput => ({
  category: "travel", claimDate: "2026-11-02", amount: 120_000, description: "Cab to client", ...overrides,
});
let fileSeq = 0;
const receipt = (uploadedBy: number) =>
  db.insert(files).values({ storageName: `r${++fileSeq}`, originalName: "cab.pdf", mime: "application/pdf", size: 1, sha256: "x", uploadedBy }).returning().get();
const inbox = (p: Person) => db.select().from(notifications).where(eq(notifications.userId, p.user.id)).all().map((n) => n.type);

beforeEach(() => {
  db = createTestDb();
  hr = person("Hema", {}, ["employee", "hr_admin"]);
  payroll = person("Pooja", {}, ["employee", "payroll_admin"]);
  ravi = person("Ravi");
  asha = person("Asha", { reportingManagerId: ravi.employee.id });
  kiran = person("Kiran", { reportingManagerId: ravi.employee.id });
  ravi = reload(ravi);
});

describe("expense claims", () => {
  it("go from draft to submitted to approved, notifying each side", () => {
    const draft = saveClaim(db, asha.user, null, { ...claim(), receiptFileId: null }, TODAY);
    expect(draft).toMatchObject({ status: "draft", employeeId: asha.employee.id, amount: 120_000 });
    expectDomainError(() => submitClaim(db, asha.user, draft.id, TODAY), "NO_RECEIPT");
    saveClaim(db, asha.user, draft.id, { ...claim({ amount: 150_000 }), receiptFileId: receipt(asha.user.id).id }, TODAY);
    expect(submitClaim(db, asha.user, draft.id, TODAY)).toMatchObject({ status: "submitted", amount: 150_000, submittedAt: TODAY.now.toISOString() });
    expect(inbox(ravi)).toEqual(["claim.submitted"]);
    expectDomainError(() => saveClaim(db, asha.user, draft.id, { ...claim(), receiptFileId: undefined }, TODAY), "NOT_DRAFT");

    expectDomainError(() => approveClaim(db, asha.user, draft.id, null, TODAY), "SELF_APPROVAL");
    expectDomainError(() => approveClaim(db, kiran.user, draft.id, null, TODAY), "FORBIDDEN");
    expectDomainError(() => approveClaim(db, payroll.user, draft.id, null, TODAY), "FORBIDDEN");
    expect(approveClaim(db, ravi.user, draft.id, "OK", TODAY)).toMatchObject({
      status: "approved", approverId: ravi.user.id, approvedAt: TODAY.now.toISOString(), decisionNote: "OK",
    });
    expect(inbox(asha)).toEqual(["claim.approved"]);
    expectDomainError(() => approveClaim(db, hr.user, draft.id, null, TODAY), "NOT_PENDING");
  });

  it("need a note to reject, can be withdrawn to draft and deleted, and can't be dated ahead", () => {
    const c = saveClaim(db, asha.user, null, { ...claim(), receiptFileId: receipt(asha.user.id).id }, TODAY);
    submitClaim(db, asha.user, c.id, TODAY);
    expectDomainError(() => rejectClaim(db, hr.user, c.id, null), "NOTE_REQUIRED");
    expect(rejectClaim(db, hr.user, c.id, "No receipt total")).toMatchObject({ status: "rejected", approverId: hr.user.id });
    expectDomainError(() => withdrawClaim(db, asha.user, c.id), "NOT_PENDING");

    const d = saveClaim(db, asha.user, null, { ...claim(), receiptFileId: receipt(asha.user.id).id }, TODAY);
    submitClaim(db, asha.user, d.id, TODAY);
    expectDomainError(() => withdrawClaim(db, kiran.user, d.id), "FORBIDDEN");
    expect(withdrawClaim(db, asha.user, d.id).status).toBe("draft");
    deleteClaim(db, asha.user, d.id);

    expectDomainError(() => saveClaim(db, asha.user, null, { ...claim({ claimDate: "2026-11-11" }), receiptFileId: null }, TODAY), "FUTURE_DATE");
    expectDomainError(() => saveClaim(db, asha.user, null, { ...claim({ claimDate: "2024-12-31" }), receiptFileId: null }, TODAY), "NOT_EMPLOYED");
  });

  it("show the receipt to the claimant, their approvers and claim viewers, not to a peer", () => {
    const file = receipt(asha.user.id);
    db.update(files).set({ uploadedBy: null }).where(eq(files.id, file.id)).run();
    saveClaim(db, asha.user, null, { ...claim(), receiptFileId: file.id }, TODAY);
    const row = db.select().from(files).where(eq(files.id, file.id)).get()!;
    expect([asha, ravi, hr, payroll, kiran].map((p) => canAccessFile(db, p.user, row))).toEqual([true, true, true, true, false]);
  });
});
