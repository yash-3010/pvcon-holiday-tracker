import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { clients, compOffLots, leaveRequests, projects, timesheetEntries, timesheets, type EmployeeRow, type LeaveTypeRow } from "@/server/db/schema";
import { seedDefaultShift } from "@/server/modules/attendance/shifts";
import { postLedger } from "@/server/modules/leave/ledger";
import { listLeaveTypes, seedDefaultLeaveTypes } from "@/server/modules/leave/types";
import { listCategories } from "@/server/modules/projects/queries";
import { seedTimesheetDefaults } from "@/server/modules/projects/service";
import { runReport } from "@/server/modules/reports/registry";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertDepartment, insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

// Tuesday 10 Nov 2026, 12:00 in India.
const NOW = new Date("2026-11-10T06:30:00Z");
let db: DB;
let hr: SessionUser, manager: SessionUser;
let boss: EmployeeRow, asha: EmployeeRow, kiran: EmployeeRow, meera: EmployeeRow;
let types: Record<string, LeaveTypeRow>;

const run = (user: SessionUser, slug: string, raw: Record<string, string> = {}) => runReport(db, user, slug, raw, NOW).result;
const withLogin = (overrides: Partial<EmployeeRow>, roles: ("employee" | "manager")[] = ["employee"]) =>
  insertEmployee(db, { dateOfJoining: "2025-01-01", userId: insertUser(db, { roles }).id, ...overrides });

beforeEach(() => {
  db = createTestDb();
  seedDefaultShift(db);
  seedDefaultLeaveTypes(db);
  seedTimesheetDefaults(db);
  types = Object.fromEntries(listLeaveTypes(db).map((t) => [t.code, t]));
  const eng = insertDepartment(db, "Engineering").id;
  const sales = insertDepartment(db, "Sales").id;
  hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"], name: "Hema HR" }));
  boss = withLogin({ firstName: "Boss", departmentId: eng }, ["manager"]);
  asha = withLogin({ firstName: "Asha", departmentId: eng, reportingManagerId: boss.id });
  kiran = withLogin({ firstName: "Kiran", departmentId: sales, reportingManagerId: boss.id });
  meera = withLogin({ firstName: "Meera", departmentId: sales });
  insertEmployee(db, { firstName: "Nologin", departmentId: sales, dateOfJoining: "2025-01-01" });
  manager = sessionUserFor(db, getUserById(db, boss.userId!)!);
});

describe("leave reports", () => {
  beforeEach(() => {
    const post = (e: EmployeeRow, code: string, delta: number, kind: "grant" | "taken" | "cancelled") =>
      postLedger(db, { employeeId: e.id, leaveTypeId: types[code]!.id, year: 2026, date: "2026-01-01", delta, kind });
    post(asha, "CL", 12, "grant");
    post(asha, "CL", -2, "taken");
    post(asha, "CL", 1, "cancelled");
    post(asha, "SL", 6, "grant");
    post(asha, "SL", -1, "taken");
    post(asha, "LWP", -1, "taken");
    post(kiran, "CL", 12, "grant");
  });

  it("shows balances and days used per type, without comp-off", () => {
    const result = run(hr, "leave-balances", { year: "2026" });
    expect(result.columns.map((c) => c.key).slice(3)).toEqual(["CL:balance", "CL:used", "SL:balance", "SL:used", "LWP:used"]);
    expect(result.rows.find((r) => r.name === "Asha Test")).toMatchObject({ "CL:balance": 11, "CL:used": 1, "SL:balance": 5, "SL:used": 1, "LWP:used": 1 });
    expect(result.rows.find((r) => r.name === "Kiran Test")).toMatchObject({ "CL:balance": 12, "CL:used": 0 });
    expect(run(manager, "leave-balances", { year: "2026" }).rows.map((r) => r.name)).toEqual(["Asha Test", "Kiran Test"]);
  });

  it("works out utilization by type", () => {
    const rows = run(hr, "leave-utilization", { year: "2026" }).rows;
    expect(rows.find((r) => r.code === "CL")).toEqual({ type: "CL · Casual leave", code: "CL", people: 1, credited: 24, used: 1, balance: 23, utilization: 4.2 });
    expect(rows.find((r) => r.code === "LWP")).toMatchObject({ used: 1, utilization: null });
    expect(rows.find((r) => r.code === "CO")).toMatchObject({ credited: 0, used: 0, utilization: null });
  });

  it("lists the requests touching a range, without withdrawn ones", () => {
    const request = (e: EmployeeRow, startDate: string, endDate: string, status: "approved" | "pending" | "withdrawn", approverId: number | null = null) =>
      db.insert(leaveRequests).values({ employeeId: e.id, leaveTypeId: types.CL!.id, startDate, endDate, startHalf: "full", endHalf: "full", days: 2, status, approverId }).run();
    request(asha, "2026-10-30", "2026-11-02", "approved", hr.id);
    request(asha, "2026-10-20", "2026-10-21", "approved");
    request(asha, "2026-11-05", "2026-11-06", "withdrawn");
    request(kiran, "2026-11-20", "2026-11-23", "pending");
    request(meera, "2026-11-12", "2026-11-13", "approved");
    const rows = run(hr, "leave-register", { from: "2026-11-01", to: "2026-11-30" }).rows;
    expect(rows.map((r) => [r.name, r.from, r.status, r.decidedBy])).toEqual([
      ["Asha Test", "2026-10-30", "Approved", "Hema HR"], ["Meera Test", "2026-11-12", "Approved", null], ["Kiran Test", "2026-11-20", "Pending", null],
    ]);
    expect(run(manager, "leave-register", { from: "2026-11-01", to: "2026-11-30" }).rows.map((r) => r.name)).toEqual(["Asha Test", "Kiran Test"]);
    expect(run(hr, "leave-register", { from: "2026-11-01", to: "2026-11-30", employee: String(kiran.id) }).rows).toHaveLength(1);
  });

  it("lists comp-off lots earned or expiring in the range and every open lot, soonest expiry first", () => {
    const lot = (e: EmployeeRow, earnedOn: string, expiresOn: string, status: "active" | "expired", remaining: number) =>
      db.insert(compOffLots).values({ employeeId: e.id, days: 1, remaining, earnedOn, expiresOn, status }).run();
    lot(asha, "2026-10-03", "2027-01-01", "active", 1);
    lot(asha, "2026-08-01", "2026-10-30", "expired", 0);
    lot(kiran, "2026-06-01", "2026-08-30", "expired", 0);
    expect(run(hr, "comp-off-lots", { from: "2026-10-01", to: "2026-11-10" }).rows).toEqual([
      { code: asha.employeeCode, name: "Asha Test", earned: "2026-08-01", source: "Granted by HR", days: 1, remaining: 0, expires: "2026-10-30", daysLeft: null, status: "Expired" },
      { code: asha.employeeCode, name: "Asha Test", earned: "2026-10-03", source: "Granted by HR", days: 1, remaining: 1, expires: "2027-01-01", daysLeft: 52, status: "Active" },
    ]);
  });
});

describe("timesheet reports", () => {
  let acme: number, internal: number, dev: number, admin: number;
  const sheet = (e: EmployeeRow, weekStart: string, status: "draft" | "submitted" | "approved", entries: [project: number, category: number, date: string, minutes: number, billable: boolean][]) => {
    const t = db.insert(timesheets).values({ employeeId: e.id, weekStart, status }).returning().get();
    for (const [projectId, taskCategoryId, date, minutes, billable] of entries) db.insert(timesheetEntries).values({ timesheetId: t.id, projectId, taskCategoryId, date, minutes, billable }).run();
  };

  beforeEach(() => {
    const client = db.insert(clients).values({ name: "Acme" }).returning().get();
    acme = db.insert(projects).values({ code: "ACME-1", name: "Acme portal", clientId: client.id, budgetHours: 10 }).returning().get().id;
    internal = db.select().from(projects).all().find((p) => p.code === "INT")!.id;
    [dev, admin] = [listCategories(db, {})[0]!.id, listCategories(db, {}).find((c) => c.name === "Internal admin")!.id];
    sheet(asha, "2026-11-02", "submitted", [[acme, dev, "2026-11-02", 480, true], [acme, dev, "2026-11-03", 240, true], [internal, admin, "2026-11-03", 240, false]]);
    sheet(asha, "2026-10-26", "approved", [[acme, dev, "2026-10-30", 120, true]]);
    sheet(kiran, "2026-11-02", "approved", [[acme, dev, "2026-11-02", 300, true]]);
    sheet(meera, "2026-11-02", "draft", [[internal, admin, "2026-11-02", 60, false]]);
  });

  it("compares logged with available hours, counting only submitted and approved weeks", () => {
    const rows = run(hr, "utilization", { from: "2026-11-02", to: "2026-11-06" }).rows;
    expect(rows.find((r) => r.name === "Asha Test")).toMatchObject({ available: 2400, logged: 960, billable: 720, utilization: 40, billableShare: 75 });
    expect(rows.find((r) => r.name === "Kiran Test")).toMatchObject({ logged: 300, utilization: 12.5, billableShare: 100 });
    expect(rows.find((r) => r.name === "Meera Test")).toMatchObject({ logged: 0, utilization: 0, billableShare: null });
  });

  it("splits billable hours by department", () => {
    expect(run(hr, "billable", { from: "2026-11-01", to: "2026-11-10" }).rows).toEqual([
      { department: "Engineering", people: 1, logged: 960, billable: 720, nonBillable: 240, billableShare: 75 },
      { department: "Sales", people: 1, logged: 300, billable: 300, nonBillable: 0, billableShare: 100 },
    ]);
  });

  it("sums hours per project, person and category, and per client", () => {
    expect(run(hr, "project-hours", { from: "2026-11-01", to: "2026-11-10", project: String(acme) }).rows).toEqual([
      { project: "ACME-1", projectName: "Acme portal", client: "Acme", name: "Asha Test", category: "Development", logged: 720, billable: 720 },
      { project: "ACME-1", projectName: "Acme portal", client: "Acme", name: "Kiran Test", category: "Development", logged: 300, billable: 300 },
    ]);
    expect(run(hr, "client-hours", { from: "2026-11-01", to: "2026-11-10" }).rows).toEqual([
      { client: "Acme", projects: 1, people: 2, logged: 1020, billable: 1020, billableShare: 100 },
      { client: "Internal", projects: 1, people: 1, logged: 240, billable: 0, billableShare: 0 },
    ]);
  });

  it("burns project budgets with all booked hours to date", () => {
    const result = run(hr, "budget-burn");
    expect(result.rows).toEqual([
      { project: "ACME-1", name: "Acme portal", client: "Acme", status: "Active", budget: 600, booked: 1140, burn: 190, remaining: -540 },
      { project: "INT", name: "Internal", client: "Internal", status: "Active", budget: null, booked: 240, burn: null, remaining: null },
    ]);
    expect(run(manager, "budget-burn").note).toMatch(/your team/);
  });

  it("lists people with working hours whose week isn't submitted", () => {
    const result = run(hr, "missing-timesheets", { week: "2026-11-04" });
    expect(result.rows).toEqual([
      { code: boss.employeeCode, name: "Boss Test", department: "Engineering", manager: null, status: "Not started", expected: 2400, logged: 0 },
      { code: meera.employeeCode, name: "Meera Test", department: "Sales", manager: null, status: "Draft", expected: 2400, logged: 60 },
    ]);
    expect(run(manager, "missing-timesheets", { week: "2026-11-02" }).rows).toEqual([]);
  });
});
