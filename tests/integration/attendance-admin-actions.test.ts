import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { attendanceDays, attendancePunches, auditLogs, type EmployeeRow } from "@/server/db/schema";
import { recomputeAttendance } from "@/server/modules/attendance/compute";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
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

import { attendanceDayAction, setOverrideAction } from "@/app/(app)/time/muster/actions";

type Person = { employee: EmployeeRow; user: SessionUser };
let hr: Person, ravi: Person, asha: Person, meera: Person;

function person(name: string, overrides: Partial<EmployeeRow> = {}, roles: ("employee" | "hr_admin")[] = ["employee"]): Person {
  const login = insertUser(state.db, { roles, name });
  const employee = insertEmployee(state.db, { firstName: name, dateOfJoining: "2025-01-01", userId: login.id, ...overrides });
  return { employee, user: sessionUserFor(state.db, login) };
}
const day = (employeeId: number, date: string) =>
  state.db.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, date))).get()!;

beforeEach(() => {
  // Tuesday 10 Nov 2026, 11:30 IST.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T06:00:00Z"));
  state.db = createTestDb();
  seedDefaultShift(state.db);
  hr = person("Hema", {}, ["employee", "hr_admin"]);
  ravi = person("Ravi");
  asha = person("Asha", { reportingManagerId: ravi.employee.id });
  meera = person("Meera");
  ravi = { ...ravi, user: sessionUserFor(state.db, getUserById(state.db, ravi.user.id)!) };
  state.user = hr.user;
});
afterEach(() => vi.useRealTimers());

describe("attendance overrides", () => {
  it("sets and clears an override with audit entries", async () => {
    recomputeAttendance(state.db, asha.employee.id, "2026-11-09", "2026-11-09");
    expect(day(asha.employee.id, "2026-11-09").status).toBe("absent");
    await expect(
      setOverrideAction({ employeeId: asha.employee.id, date: "2026-11-09", status: "present", note: "Was at the client site" }),
    ).resolves.toEqual({ ok: true, data: { status: "present" } });
    expect(day(asha.employee.id, "2026-11-09")).toMatchObject({ status: "present", overrideStatus: "present", overrideBy: hr.user.id });
    await expect(setOverrideAction({ employeeId: asha.employee.id, date: "2026-11-09", status: null, note: "" })).resolves.toEqual({
      ok: true, data: { status: "absent" },
    });
    expect(state.db.select().from(auditLogs).all().map((a) => a.action)).toEqual(["attendance.override", "attendance.override"]);
  });

  it("wants a note, refuses one's own record, future days and locked days", async () => {
    await expect(setOverrideAction({ employeeId: asha.employee.id, date: "2026-11-09", status: "present", note: "" })).resolves.toMatchObject({
      code: "VALIDATION", fieldErrors: { note: ["Explain the override"] },
    });
    await expect(setOverrideAction({ employeeId: hr.employee.id, date: "2026-11-09", status: "present", note: "My day" })).resolves.toMatchObject({
      code: "SELF_OVERRIDE",
    });
    await expect(setOverrideAction({ employeeId: asha.employee.id, date: "2026-11-11", status: "present", note: "Ahead" })).resolves.toMatchObject({
      code: "FUTURE_DATE",
    });
    recomputeAttendance(state.db, asha.employee.id, "2026-11-06", "2026-11-06");
    state.db.update(attendanceDays).set({ locked: true }).where(eq(attendanceDays.date, "2026-11-06")).run();
    await expect(setOverrideAction({ employeeId: asha.employee.id, date: "2026-11-06", status: "present", note: "Late fix" })).resolves.toMatchObject({
      code: "DAY_LOCKED",
    });
  });

  it("needs attendance.manage", async () => {
    state.user = ravi.user;
    await expect(setOverrideAction({ employeeId: asha.employee.id, date: "2026-11-09", status: "present", note: "Client site" })).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("day detail", () => {
  it("shows punches to HR and to the manager above, and to no one else", async () => {
    state.db.insert(attendancePunches).values([
      { employeeId: asha.employee.id, at: "2026-11-09T04:00:00.000Z", date: "2026-11-09", direction: "in", workMode: "remote" },
      { employeeId: asha.employee.id, at: "2026-11-09T13:00:00.000Z", date: "2026-11-09", direction: "out", workMode: "remote" },
    ]).run();
    recomputeAttendance(state.db, asha.employee.id, "2026-11-09", "2026-11-09");
    const result = await attendanceDayAction({ employeeId: asha.employee.id, date: "2026-11-09" });
    expect(result).toMatchObject({
      ok: true,
      data: {
        employee: { name: "Asha Test" },
        row: { status: "present", workedMinutes: 540 },
        punches: [{ time: "09:30", direction: "in", workMode: "remote" }, { time: "18:30", direction: "out" }],
      },
    });
    state.user = ravi.user;
    await expect(attendanceDayAction({ employeeId: asha.employee.id, date: "2026-11-09" })).resolves.toMatchObject({ ok: true });
    await expect(attendanceDayAction({ employeeId: meera.employee.id, date: "2026-11-09" })).resolves.toMatchObject({ code: "FORBIDDEN" });
    state.user = meera.user;
    await expect(attendanceDayAction({ employeeId: asha.employee.id, date: "2026-11-09" })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
