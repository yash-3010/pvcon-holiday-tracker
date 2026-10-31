import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { attendancePunches, auditLogs, timesheetEntries } from "@/server/db/schema";
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
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { endWorkAction, resumeWorkAction, startWorkAction, switchTaskAction, takeBreakAction } from "@/app/(app)/actions";

let internal: number, dev: number, training: number;
const at = (iso: string) => vi.setSystemTime(new Date(iso));
const audits = () => state.db.select().from(auditLogs).all().map((a) => a.summary);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2026-11-10T04:00:00Z"); // Tuesday, 09:30 in Pune
  state.db = createTestDb();
  seedDefaultShift(state.db);
  seedDefaultLeaveTypes(state.db);
  seedTimesheetDefaults(state.db);
  const login = insertUser(state.db);
  const employee = insertEmployee(state.db, { dateOfJoining: "2025-01-01", userId: login.id });
  state.user = sessionUserFor(state.db, login);
  internal = allowedProjects(state.db, employee.id, "2026-11-10")[0]!.id;
  [dev, training] = [listCategories(state.db, {})[0]!.id, listCategories(state.db, {}).find((c) => c.name === "Training")!.id];
});
afterEach(() => vi.useRealTimers());

describe("work clock actions", () => {
  it("run a day, return the clock as it stands, and audit each step", async () => {
    const started = await startWorkAction({ workMode: "remote", selection: { projectId: internal, taskCategoryId: dev, notes: null } });
    expect(started).toMatchObject({ ok: true, data: { time: "09:30", snapshot: { state: "working", logging: { label: "INT · Internal · Development" } } } });
    expect(await startWorkAction({ workMode: "remote", selection: null })).toMatchObject({ ok: false, code: "ALREADY_IN" });

    at("2026-11-10T07:30:00Z");
    expect(await takeBreakAction({})).toMatchObject({ ok: true, data: { added: { minutes: 210 }, snapshot: { state: "break" } } });
    at("2026-11-10T08:15:00Z");
    expect(await resumeWorkAction({})).toMatchObject({ ok: true, data: { snapshot: { state: "working" } } });
    at("2026-11-10T10:15:00Z");
    expect(await switchTaskAction({ projectId: internal, taskCategoryId: training, notes: "Security course" })).toMatchObject({
      ok: true, data: { added: { minutes: 120 }, snapshot: { logging: { label: "INT · Internal · Training", notes: "Security course" } } },
    });
    at("2026-11-10T13:15:00Z");
    expect(await endWorkAction({})).toMatchObject({ ok: true, data: { time: "18:45", snapshot: { state: "done", breakSeconds: 2700 } } });
    expect(await endWorkAction({})).toMatchObject({ ok: false, code: "NOT_IN" });

    expect(state.db.select().from(timesheetEntries).all().map((e) => [e.taskCategoryId === dev ? "dev" : "training", e.minutes])).toEqual([
      ["dev", 330], ["training", 180],
    ]);
    expect(state.db.select().from(attendancePunches).all().map((p) => [p.direction, p.startsBreak, p.ip])).toEqual([
      ["in", false, "203.0.113.7"], ["out", true, "203.0.113.7"], ["in", false, "203.0.113.7"], ["out", false, "203.0.113.7"],
    ]);
    expect(audits()).toEqual([
      "Clocked in at 09:30 (remote), logging to INT · Internal · Development",
      "Started a break at 13:00; 3.5 h to the timesheet",
      "Back from a break at 13:45",
      "Switched to INT · Internal · Training at 15:45; 2 h to the timesheet",
      "Clocked out at 18:45; 3 h to the timesheet",
    ]);
  });

  it("need an employee record", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
    expect(await startWorkAction({ workMode: "office", selection: null })).toMatchObject({ code: "FORBIDDEN" });
    expect(await switchTaskAction({ projectId: internal, taskCategoryId: dev, notes: null })).toMatchObject({ code: "FORBIDDEN" });
  });
});
