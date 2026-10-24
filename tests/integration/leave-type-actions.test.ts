import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { LeaveTypeInput } from "@/lib/validation/leave";
import type { DB } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { compOffType, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { createTestDb } from "../helpers/db";
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

import { archiveLeaveTypeAction, createLeaveTypeAction, updateLeaveTypeAction } from "@/app/(app)/leave/types/actions";

const earned: LeaveTypeInput = {
  code: "EL", name: "Earned leave", color: "#16a34a", paid: true, isLop: false, accrual: "monthly", annualQuota: 15,
  carryForwardMax: 30, encashable: true, allowHalfDay: true, allowNegative: false, maxConsecutiveDays: null, minNoticeDays: 7,
  attachmentAfterDays: null, countWeekends: false, applicableEmploymentTypes: null,
};
const actions = () => state.db.select().from(auditLogs).all().map((a) => a.action);

beforeEach(() => {
  state.db = createTestDb();
  seedDefaultLeaveTypes(state.db);
  state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
});

describe("leave type actions", () => {
  it("creates, updates and archives with audit entries", async () => {
    const created = await createLeaveTypeAction(earned);
    expect(created).toMatchObject({ ok: true });
    const id = (created as { data: { id: number } }).data.id;
    await expect(updateLeaveTypeAction({ ...earned, id, annualQuota: 18 })).resolves.toMatchObject({ ok: true });
    await expect(archiveLeaveTypeAction({ id, archived: true })).resolves.toEqual({ ok: true, data: { archived: true } });
    expect(actions()).toEqual(["leave_type.create", "leave_type.update", "leave_type.archive"]);
    const update = state.db.select().from(auditLogs).all()[1]!;
    expect(update.diff).toEqual({ annualQuota: { from: 15, to: 18 } });
  });

  it("surfaces the comp-off guard", async () => {
    const co = compOffType(state.db)!;
    await expect(archiveLeaveTypeAction({ id: co.id, archived: true })).resolves.toMatchObject({ ok: false, code: "SYSTEM_TYPE" });
  });

  it("needs leave.config", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["manager"] }));
    await expect(createLeaveTypeAction(earned)).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
