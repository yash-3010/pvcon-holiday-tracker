import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { BankInput } from "@/lib/validation/employees";
import type { DB } from "@/server/db/client";
import { employees, notifications, type EmployeeRow, type UserRow } from "@/server/db/schema";
import {
  decideProfileChange, listPendingProfileChanges, pendingProfileChangeFor, submitProfileChange, withdrawProfileChange,
} from "@/server/modules/employees/profile-changes";
import { openBank } from "@/server/modules/employees/sensitive";
import { createEmployee } from "@/server/modules/employees/service";
import { createTestDb } from "../helpers/db";
import { employeeInput } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const change = (patch: Partial<BankInput> = {}): BankInput => ({
  bankName: null, bankAccount: null, bankIfsc: null, pan: null, aadhaar: null, passport: null, ...patch,
});
const newAccount = change({ bankName: "HDFC Bank", bankAccount: "444455556666", bankIfsc: "HDFC0001234" });

let db: DB;
let hrUser: UserRow;
let hr: SessionUser;
let ashaUser: UserRow;
let asha: EmployeeRow;
const employeeRow = (id: number) => db.select().from(employees).where(eq(employees.id, id)).get()!;

beforeEach(() => {
  db = createTestDb();
  hrUser = insertUser(db, { roles: ["hr_admin"] });
  hr = sessionUserFor(db, hrUser);
  ashaUser = insertUser(db, { roles: ["employee"] });
  asha = createEmployee(
    db, hr,
    employeeInput({ bankName: "SBI", bankAccount: "111122223333", bankIfsc: "SBIN0000001", pan: "ABCDE1234F" }),
    { login: { mode: "link", userId: ashaUser.id }, onboarding: false },
  );
});

describe("submitting", () => {
  it("stores requested values encrypted and notifies HR, not the requester", () => {
    const request = submitProfileChange(db, asha.id, ashaUser.id, newAccount, "New salary account");
    expect(JSON.stringify(request)).not.toContain("444455556666");
    expect(request).toMatchObject({ status: "pending", reason: "New salary account", requestedBy: ashaUser.id });
    expect(db.select().from(notifications).all().map((n) => [n.userId, n.type, n.link])).toEqual([
      [hrUser.id, "profile_change.submitted", "/approvals"],
    ]);
  });

  it("needs at least one value and allows one pending request at a time", () => {
    expectDomainError(() => submitProfileChange(db, asha.id, ashaUser.id, change(), null), "NOTHING_TO_CHANGE");
    submitProfileChange(db, asha.id, ashaUser.id, change({ bankIfsc: "HDFC0001234" }), null);
    expectDomainError(() => submitProfileChange(db, asha.id, ashaUser.id, change({ bankIfsc: "ICIC0001234" }), null), "PENDING_EXISTS");
  });

  it("lets the employee withdraw only their own pending request", () => {
    const request = submitProfileChange(db, asha.id, ashaUser.id, newAccount, null);
    const other = createEmployee(db, hr, employeeInput({ firstName: "Ravi" }), { login: { mode: "none" }, onboarding: false });
    expectDomainError(() => withdrawProfileChange(db, other.id, request.id), "NOT_FOUND");
    expect(withdrawProfileChange(db, asha.id, request.id).status).toBe("withdrawn");
    expect(pendingProfileChangeFor(db, asha.id)).toBeUndefined();
    expectDomainError(() => withdrawProfileChange(db, asha.id, request.id), "NOT_PENDING");
  });
});

describe("deciding", () => {
  it("applies only the provided values on approval and tells the employee", () => {
    const request = submitProfileChange(db, asha.id, ashaUser.id, newAccount, null);
    const result = decideProfileChange(db, hrUser.id, request.id, "approved", "Verified the cancelled cheque");
    expect(result.request).toMatchObject({ status: "approved", approverId: hrUser.id, note: "Verified the cancelled cheque" });
    expect([result.before.bankAccount, result.after.bankAccount]).toEqual(["XXXX3333", "XXXX6666"]);
    expect(openBank(employeeRow(asha.id))).toEqual({
      bankName: "HDFC Bank", bankAccount: "444455556666", bankIfsc: "HDFC0001234", pan: "ABCDE1234F", aadhaar: null, passport: null,
    });
    const toAsha = db.select().from(notifications).where(eq(notifications.userId, ashaUser.id)).all();
    expect(toAsha.map((n) => [n.type, n.link])).toEqual([["profile_change.approved", "/me/profile"]]);
    expectDomainError(() => decideProfileChange(db, hrUser.id, request.id, "rejected", null), "NOT_PENDING");
  });

  it("leaves bank details untouched on rejection", () => {
    const request = submitProfileChange(db, asha.id, ashaUser.id, newAccount, null);
    expect(decideProfileChange(db, hrUser.id, request.id, "rejected", "Name mismatch").request.status).toBe("rejected");
    expect(openBank(employeeRow(asha.id)).bankAccount).toBe("111122223333");
  });

  it("refuses to let people decide their own request", () => {
    const hari = createEmployee(db, hr, employeeInput({ firstName: "Hari" }), { login: { mode: "link", userId: hrUser.id }, onboarding: false });
    const request = submitProfileChange(db, hari.id, hrUser.id, change({ bankIfsc: "HDFC0001234" }), null);
    expectDomainError(() => decideProfileChange(db, hrUser.id, request.id, "approved", null), "SELF_APPROVAL");
  });
});

describe("listPendingProfileChanges", () => {
  it("masks current and requested values unless revealed", () => {
    submitProfileChange(db, asha.id, ashaUser.id, newAccount, null);
    const [masked] = listPendingProfileChanges(db, false);
    expect(masked).toMatchObject({
      employeeName: "Asha Rao",
      current: { bankAccount: "XXXX3333", pan: "XXXX234F" },
      requested: { bankAccount: "XXXX6666", pan: null },
    });
    expect(JSON.stringify(masked)).not.toMatch(/444455556666|111122223333|Enc/);
    expect(listPendingProfileChanges(db, true)[0]!.requested.bankAccount).toBe("444455556666");
  });
});
