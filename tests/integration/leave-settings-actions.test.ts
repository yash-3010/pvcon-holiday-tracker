import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { postLedger } from "@/server/modules/leave/ledger";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { getSetting } from "@/server/modules/settings/service";
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

import { updateLeaveSettingsAction } from "@/app/(app)/settings/leave/actions";

beforeEach(() => {
  state.db = createTestDb();
  state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
});

describe("leave settings", () => {
  it("saves the leave year and weekly offs, with an audit entry", async () => {
    await expect(updateLeaveSettingsAction({ yearStartMonth: 4, weeklyOffs: [0] })).resolves.toEqual({ ok: true, data: { yearStartMonth: 4 } });
    expect(getSetting(state.db, "leave").yearStartMonth).toBe(4);
    expect(getSetting(state.db, "attendance").weeklyOffs).toEqual([0]);
    expect(state.db.select().from(auditLogs).all().map((a) => [a.action, a.entityId])).toEqual([["settings.update", "leave"]]);
  });

  it("locks the leave year once leave has been posted, but not the weekly offs", async () => {
    seedDefaultLeaveTypes(state.db);
    const e = insertEmployee(state.db);
    postLedger(state.db, { employeeId: e.id, leaveTypeId: listLeaveTypes(state.db)[0]!.id, year: 2026, date: "2026-01-01", delta: 12, kind: "grant" });
    await expect(updateLeaveSettingsAction({ yearStartMonth: 4, weeklyOffs: [0, 6] })).resolves.toMatchObject({ ok: false, code: "LEAVE_YEAR_LOCKED" });
    await expect(updateLeaveSettingsAction({ yearStartMonth: 1, weeklyOffs: [5, 6] })).resolves.toMatchObject({ ok: true });
    expect(getSetting(state.db, "attendance").weeklyOffs).toEqual([5, 6]);
  });

  it("needs leave.config", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["manager"] }));
    await expect(updateLeaveSettingsAction({ yearStartMonth: 1, weeklyOffs: [0, 6] })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
