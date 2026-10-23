import { beforeEach, describe, expect, it } from "vitest";
import type { LeaveTypeInput } from "@/lib/validation/leave";
import type { DB } from "@/server/db/client";
import { leaveLedger } from "@/server/db/schema";
import { weeklyOffsForEmployee } from "@/server/modules/attendance/calendar";
import {
  compOffType, createLeaveType, isApplicable, listLeaveTypes, requireLeaveType, seedDefaultLeaveTypes, setLeaveTypeArchived,
  updateLeaveType,
} from "@/server/modules/leave/types";
import { patchSetting } from "@/server/modules/settings/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError } from "../helpers/fixtures";

let db: DB;
beforeEach(() => {
  db = createTestDb();
});

const earned: LeaveTypeInput = {
  code: "EL", name: "Earned leave", color: "#16a34a", paid: true, isLop: false, accrual: "monthly", annualQuota: 15,
  carryForwardMax: 30, encashable: true, allowHalfDay: true, allowNegative: false, maxConsecutiveDays: null, minNoticeDays: 7,
  attachmentAfterDays: null, countWeekends: false, applicableEmploymentTypes: ["full_time"],
};

describe("default leave types", () => {
  it("seeds CL, SL, LWP and the system comp-off type once", () => {
    expect(seedDefaultLeaveTypes(db)).toBe(4);
    expect(seedDefaultLeaveTypes(db)).toBe(0);
    const types = listLeaveTypes(db);
    expect(types.map((t) => t.code)).toEqual(["CL", "SL", "LWP", "CO"]);
    expect(types.find((t) => t.code === "CL")).toMatchObject({ accrual: "upfront", annualQuota: 12, carryForwardMax: 6, maxConsecutiveDays: 3, minNoticeDays: 1 });
    expect(types.find((t) => t.code === "SL")).toMatchObject({ annualQuota: 6, carryForwardMax: 0, minNoticeDays: 0, attachmentAfterDays: 2 });
    expect(types.find((t) => t.code === "LWP")).toMatchObject({ paid: false, isLop: true, accrual: "none", allowNegative: true });
    expect(compOffType(db)).toMatchObject({ code: "CO", isCompOff: true, accrual: "none", annualQuota: 0 });
  });
});

describe("leave type service", () => {
  it("creates, updates and archives a type", () => {
    const created = createLeaveType(db, earned);
    expect(created).toMatchObject({ code: "EL", accrual: "monthly", applicableEmploymentTypes: ["full_time"], isCompOff: false });
    const { before, after } = updateLeaveType(db, created.id, { ...earned, name: "Privilege leave" });
    expect([before.name, after.name]).toEqual(["Earned leave", "Privilege leave"]);
    expect(setLeaveTypeArchived(db, created.id, true).archived).toBe(true);
    expect(listLeaveTypes(db).map((t) => t.code)).toEqual([]);
    expect(listLeaveTypes(db, { includeArchived: true }).map((t) => t.code)).toEqual(["EL"]);
  });

  it("keeps codes unique", () => {
    createLeaveType(db, earned);
    expectDomainError(() => createLeaveType(db, { ...earned, name: "Other" }), "CODE_TAKEN");
  });

  it("refuses a new code once the old one has ledger history", () => {
    const type = createLeaveType(db, earned);
    const e = insertEmployee(db);
    db.insert(leaveLedger).values({ employeeId: e.id, leaveTypeId: type.id, year: 2026, date: "2026-01-01", delta: 1, kind: "accrual" }).run();
    expectDomainError(() => updateLeaveType(db, type.id, { ...earned, code: "PL" }), "TYPE_IN_USE");
    expect(updateLeaveType(db, type.id, { ...earned, name: "Renamed" }).after.code).toBe("EL");
  });

  it("protects the system comp-off type", () => {
    seedDefaultLeaveTypes(db);
    const co = compOffType(db)!;
    const input: LeaveTypeInput = {
      code: co.code, name: "Compensatory off", color: co.color, paid: co.paid, isLop: co.isLop, accrual: co.accrual,
      annualQuota: co.annualQuota, carryForwardMax: co.carryForwardMax, encashable: co.encashable, allowHalfDay: co.allowHalfDay,
      allowNegative: co.allowNegative, maxConsecutiveDays: co.maxConsecutiveDays, minNoticeDays: co.minNoticeDays,
      attachmentAfterDays: co.attachmentAfterDays, countWeekends: co.countWeekends, applicableEmploymentTypes: co.applicableEmploymentTypes,
    };
    expect(updateLeaveType(db, co.id, input).after).toMatchObject({ name: "Compensatory off", isCompOff: true });
    expectDomainError(() => updateLeaveType(db, co.id, { ...input, code: "COMP" }), "SYSTEM_TYPE");
    expectDomainError(() => updateLeaveType(db, co.id, { ...input, accrual: "monthly" }), "SYSTEM_TYPE");
    expectDomainError(() => updateLeaveType(db, co.id, { ...input, annualQuota: 5 }), "SYSTEM_TYPE");
    expectDomainError(() => setLeaveTypeArchived(db, co.id, true), "SYSTEM_TYPE");
  });

  it("reports missing types", () => {
    expectDomainError(() => requireLeaveType(db, 999), "NOT_FOUND");
  });

  it("applies to every employment type unless restricted", () => {
    const type = createLeaveType(db, earned);
    expect(isApplicable(type, "full_time")).toBe(true);
    expect(isApplicable(type, "intern")).toBe(false);
    expect(isApplicable({ ...type, applicableEmploymentTypes: null }, "intern")).toBe(true);
  });
});

describe("attendance calendar seam", () => {
  it("uses the company weekly offs until shifts exist", () => {
    const e = insertEmployee(db);
    expect(weeklyOffsForEmployee(db, e.id)).toEqual([0, 6]);
    patchSetting(db, "attendance", { weeklyOffs: [0] }, null);
    expect(weeklyOffsForEmployee(db, e.id)).toEqual([0]);
  });
});
