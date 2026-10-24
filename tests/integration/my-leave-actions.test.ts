import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, files, holidaySelections, leaveRequests, type EmployeeRow, type LeaveTypeRow } from "@/server/db/schema";
import { createHoliday, setYearConfig } from "@/server/modules/holidays/service";
import { syncEntitlements } from "@/server/modules/leave/ledger";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import {
  applyLeaveAction, cancelLeaveAction, toggleOptionalHolidayAction, withdrawLeaveAction,
} from "@/app/(app)/me/leave/actions";

const PDF = new Uint8Array(Buffer.from("%PDF-1.7 medical certificate"));
let dir: string;
let types: Record<string, LeaveTypeRow>;
let asha: { employee: EmployeeRow; user: SessionUser };
let ravi: { employee: EmployeeRow; user: SessionUser };

function person(name: string, overrides: Partial<EmployeeRow> = {}) {
  const login = insertUser(state.db, { roles: ["employee"], name });
  const employee = insertEmployee(state.db, { firstName: name, dateOfJoining: "2025-01-01", userId: login.id, ...overrides });
  syncEntitlements(state.db, employee.id, "2026-10-20");
  return { employee, user: sessionUserFor(state.db, login) };
}

function form(values: Record<string, string>, file?: File): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries({ startHalf: "full", endHalf: "full", reason: "", ...values })) data.set(k, v);
  if (file) data.set("attachment", file);
  return data;
}

const actions = () => state.db.select().from(auditLogs).all().map((a) => a.action);

beforeEach(() => {
  // Tuesday 20 Oct 2026, mid-morning in India.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T05:00:00Z"));
  dir = mkdtempSync(path.join(tmpdir(), "pvcon-leave-"));
  vi.stubEnv("UPLOAD_DIR", dir);
  state.db = createTestDb();
  seedDefaultLeaveTypes(state.db);
  types = Object.fromEntries(listLeaveTypes(state.db).map((t) => [t.code, t]));
  ravi = person("Ravi");
  asha = person("Asha", { reportingManagerId: ravi.employee.id });
  ravi = { ...ravi, user: sessionUserFor(state.db, getUserById(state.db, ravi.user.id)!) };
  state.user = asha.user;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("applying from My leave", () => {
  it("creates a pending request with the counted days", async () => {
    const result = await applyLeaveAction(form({ leaveTypeId: String(types.CL.id), startDate: "2026-11-06", endDate: "2026-11-09", reason: "Wedding" }));
    expect(result).toMatchObject({ ok: true, data: { days: 2, status: "pending" } });
    expect(state.db.select().from(leaveRequests).get()).toMatchObject({ days: 2, reason: "Wedding", attachmentFileId: null });
    expect(actions()).toEqual(["leave.apply"]);
  });

  it("stores a supporting document", async () => {
    const result = await applyLeaveAction(
      form({ leaveTypeId: String(types.SL.id), startDate: "2026-10-19", endDate: "2026-10-21" }, new File([PDF], "certificate.pdf")),
    );
    expect(result).toMatchObject({ ok: true, data: { days: 3 } });
    const request = state.db.select().from(leaveRequests).get()!;
    expect(state.db.select().from(files).where(eq(files.id, request.attachmentFileId!)).get()).toMatchObject({
      originalName: "certificate.pdf", uploadedBy: asha.user.id,
    });
  });

  it("returns field errors for bad input and rule errors from the service", async () => {
    await expect(applyLeaveAction(form({ leaveTypeId: String(types.CL.id), startDate: "2026-11-09", endDate: "2026-11-06" }))).resolves.toMatchObject({
      ok: false, code: "VALIDATION", fieldErrors: { endDate: expect.any(Array) },
    });
    await expect(applyLeaveAction(form({ leaveTypeId: String(types.SL.id), startDate: "2026-10-19", endDate: "2026-10-21" }))).resolves.toMatchObject({
      ok: false, code: "ATTACHMENT_REQUIRED",
    });
    expect(state.db.select().from(files).all()).toEqual([]);
  });

  it("needs an employee record", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
    await expect(applyLeaveAction(form({ leaveTypeId: String(types.CL.id), startDate: "2026-11-06", endDate: "2026-11-06" }))).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("withdrawing and cancelling", () => {
  it("only lets the owner withdraw, and cancels approved future leave", async () => {
    await applyLeaveAction(form({ leaveTypeId: String(types.CL.id), startDate: "2026-11-06", endDate: "2026-11-06" }));
    const request = state.db.select().from(leaveRequests).get()!;
    state.user = ravi.user;
    await expect(withdrawLeaveAction({ requestId: request.id })).resolves.toMatchObject({ code: "FORBIDDEN" });
    state.user = asha.user;
    await expect(withdrawLeaveAction({ requestId: request.id })).resolves.toEqual({ ok: true, data: { status: "withdrawn" } });

    await applyLeaveAction(form({ leaveTypeId: String(types.CL.id), startDate: "2026-11-10", endDate: "2026-11-10" }));
    const second = state.db.select().from(leaveRequests).where(eq(leaveRequests.startDate, "2026-11-10")).get()!;
    state.db.update(leaveRequests).set({ status: "approved" }).where(eq(leaveRequests.id, second.id)).run();
    await expect(cancelLeaveAction({ requestId: second.id, note: null })).resolves.toEqual({ ok: true, data: { status: "cancelled" } });
    expect(actions()).toEqual(["leave.apply", "leave.withdraw", "leave.apply", "leave.cancel"]);
  });
});

describe("optional holidays", () => {
  it("picks and unpicks within the allowance", async () => {
    setYearConfig(state.db, 2026, 1);
    const diwali = createHoliday(state.db, { date: "2026-11-08", name: "Diwali", type: "optional" });
    const christmas = createHoliday(state.db, { date: "2026-12-25", name: "Christmas", type: "optional" });
    await expect(toggleOptionalHolidayAction({ holidayId: diwali.id, selected: true })).resolves.toMatchObject({ ok: true });
    await expect(toggleOptionalHolidayAction({ holidayId: christmas.id, selected: true })).resolves.toMatchObject({ code: "OPTIONAL_LIMIT" });
    await expect(toggleOptionalHolidayAction({ holidayId: diwali.id, selected: false })).resolves.toMatchObject({ ok: true });
    expect(state.db.select().from(holidaySelections).all()).toEqual([]);
    expect(actions()).toEqual(["holiday.pick", "holiday.unpick"]);
  });
});
