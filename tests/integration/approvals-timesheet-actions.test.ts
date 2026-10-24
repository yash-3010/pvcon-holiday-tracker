import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, timesheets, type EmployeeRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { listCategories } from "@/server/modules/projects/queries";
import { seedTimesheetDefaults } from "@/server/modules/projects/service";
import { allowedProjects, saveWeek, submitTimesheet } from "@/server/modules/timesheets/service";
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

import { bulkApproveTimesheetsAction, decideTimesheetAction, timesheetDetailAction } from "@/app/(app)/approvals/actions";

const WEEK = "2026-10-19";
const TODAY = "2026-10-28";
type Person = { employee: EmployeeRow; user: SessionUser };
let ravi: Person, asha: Person, meera: Person;

function person(name: string, overrides: Partial<EmployeeRow> = {}): Person {
  const login = insertUser(state.db, { name });
  return { employee: insertEmployee(state.db, { firstName: name, dateOfJoining: "2025-01-01", userId: login.id, ...overrides }), user: sessionUserFor(state.db, login) };
}
function submitted(p: Person): number {
  const internal = allowedProjects(state.db, p.employee.id, TODAY)[0]!;
  saveWeek(
    state.db, p.user,
    { weekStart: WEEK, rows: [{ projectId: internal.id, taskCategoryId: listCategories(state.db, {})[0]!.id, billable: false, notes: "", minutes: { [WEEK]: 480 } }] },
    { today: TODAY },
  );
  return submitTimesheet(state.db, p.user, WEEK, { today: TODAY, now: new Date() }).id;
}
const status = (id: number) => state.db.select().from(timesheets).where(eq(timesheets.id, id)).get()!.status;
const audits = () => state.db.select().from(auditLogs).all().map((a) => a.action);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T06:00:00Z"));
  state.db = createTestDb();
  seedDefaultShift(state.db);
  seedDefaultLeaveTypes(state.db);
  seedTimesheetDefaults(state.db);
  ravi = person("Ravi");
  asha = person("Asha", { reportingManagerId: ravi.employee.id });
  meera = person("Meera");
  ravi = { ...ravi, user: sessionUserFor(state.db, getUserById(state.db, ravi.user.id)!) };
  state.user = ravi.user;
});
afterEach(() => vi.useRealTimers());

describe("timesheet approvals", () => {
  it("approves or rejects with a reason, with audit entries", async () => {
    const id = submitted(asha);
    await expect(decideTimesheetAction({ timesheetId: id, decision: "rejected", note: "" })).resolves.toMatchObject({
      ok: false, code: "VALIDATION", fieldErrors: { note: ["Say what needs fixing"] },
    });
    await expect(decideTimesheetAction({ timesheetId: id, decision: "rejected", note: "Split meetings out" })).resolves.toEqual({ ok: true, data: { status: "rejected" } });
    state.user = asha.user;
    submitTimesheet(state.db, asha.user, WEEK, { today: TODAY, now: new Date() });
    state.user = ravi.user;
    await expect(decideTimesheetAction({ timesheetId: id, decision: "approved", note: null })).resolves.toEqual({ ok: true, data: { status: "approved" } });
    expect(audits()).toEqual(["timesheet.reject", "timesheet.approve"]);
  });

  it("bulk-approves what the approver may decide", async () => {
    const a = submitted(asha);
    const m = submitted(meera);
    await expect(bulkApproveTimesheetsAction({ timesheetIds: [a, m], note: null })).resolves.toMatchObject({ ok: true, data: { approved: 1, failed: [{ id: m }] } });
    expect([status(a), status(m)]).toEqual(["approved", "submitted"]);
    expect(audits()).toEqual(["timesheet.approve"]);
  });

  it("opens a week for its approver only", async () => {
    const a = submitted(asha);
    const m = submitted(meera);
    await expect(timesheetDetailAction({ timesheetId: a })).resolves.toMatchObject({ ok: true, data: { employeeName: "Asha Test", week: { weekStart: WEEK } } });
    await expect(timesheetDetailAction({ timesheetId: m })).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    state.user = meera.user;
    await expect(timesheetDetailAction({ timesheetId: a })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
