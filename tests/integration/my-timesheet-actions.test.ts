import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, timesheetEntries, timesheets, type ProjectRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { listCategories } from "@/server/modules/projects/queries";
import { seedTimesheetDefaults } from "@/server/modules/projects/service";
import { allowedProjects } from "@/server/modules/timesheets/service";
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
  saveWeekAction, submitWeekAction, withdrawWeekAction,
} from "@/app/(app)/me/timesheets/actions";

const WEEK = "2026-10-19";
let internal: ProjectRow;
let dev: number;
const audits = () => state.db.select().from(auditLogs).all().map((a) => a.action);
const rows = (minutes: Record<string, number>) => [{ projectId: internal.id, taskCategoryId: dev, billable: true, notes: "Build", minutes }];

beforeEach(() => {
  // Wednesday 21 Oct 2026, 11:30 IST.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T06:00:00Z"));
  state.db = createTestDb();
  seedDefaultShift(state.db);
  seedDefaultLeaveTypes(state.db);
  seedTimesheetDefaults(state.db);
  const login = insertUser(state.db);
  const employee = insertEmployee(state.db, { dateOfJoining: "2025-01-01", userId: login.id });
  state.user = sessionUserFor(state.db, login);
  internal = allowedProjects(state.db, employee.id, "2026-10-21")[0]!;
  dev = listCategories(state.db, {})[0]!.id;
});
afterEach(() => vi.useRealTimers());

describe("my timesheet actions", () => {
  it("saves, submits (saving first) and withdraws a week", async () => {
    await expect(saveWeekAction({ weekStart: WEEK, rows: rows({ "2026-10-19": 480 }) })).resolves.toEqual({
      ok: true, data: { status: "draft", warnings: [], version: expect.any(String) },
    });
    await expect(submitWeekAction({ weekStart: WEEK, rows: rows({ "2026-10-19": 480, "2026-10-20": 450 }) })).resolves.toEqual({
      ok: true, data: { status: "submitted" },
    });
    expect(state.db.select().from(timesheetEntries).all().map((e) => e.minutes)).toEqual([480, 450]);
    const id = state.db.select().from(timesheets).get()!.id;
    await expect(withdrawWeekAction({ timesheetId: id })).resolves.toEqual({ ok: true, data: { status: "draft" } });
    expect(audits()).toEqual(["timesheet.save", "timesheet.submit", "timesheet.withdraw"]);
  });

  it("keeps the saved entries when submitting fails", async () => {
    await saveWeekAction({ weekStart: WEEK, rows: rows({ "2026-10-19": 480 }) });
    await expect(submitWeekAction({ weekStart: WEEK, rows: rows({ "2026-10-23": 60 }) })).resolves.toMatchObject({ ok: false, code: "FUTURE_DATE" });
    expect(state.db.select().from(timesheetEntries).all().map((e) => e.minutes)).toEqual([480]);
  });

  it("refuses to save a grid opened before the week last changed", async () => {
    const first = await saveWeekAction({ weekStart: WEEK, rows: rows({ "2026-10-19": 480 }), version: null });
    if (!first.ok) throw new Error(first.error);
    vi.setSystemTime(new Date("2026-10-21T07:00:00Z"));
    await expect(saveWeekAction({ weekStart: WEEK, rows: rows({ "2026-10-20": 60 }), version: null })).resolves.toMatchObject({ ok: false, code: "TIMESHEET_CHANGED" });
    await expect(saveWeekAction({ weekStart: WEEK, rows: rows({ "2026-10-20": 60 }), version: first.data.version })).resolves.toMatchObject({ ok: true });
  });

  it("needs an employee record", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
    await expect(saveWeekAction({ weekStart: WEEK, rows: [] })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
