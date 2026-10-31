/**
 * The demo company behind `npm run db:demo`: 13 people in six departments with three months of history (attendance,
 * leave, timesheets, claims, two paid payroll runs) and something waiting in every inbox. Dates are worked out from
 * `now`, so the data always looks current. Everything goes through the app's own services, so balances, attendance
 * days and payslips follow the real rules.
 */
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "@cantoo/pdf-lib";
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import type { Role } from "../src/lib/auth/permissions";
import {
  addDays, addMonths, dayOfWeek, eachDay, formatDate, minutesInZone, monthRange, periodOf, startOfWeek, todayInTimeZone, zonedInstant,
  type ISODate,
} from "../src/lib/dates";
import { leaveYearOf } from "../src/lib/leave";
import type { DB } from "../src/server/db/client";
import { attendanceDays, attendancePunches, employees, notifications, projects, users, type EmployeeRow } from "../src/server/db/schema";
import { createAnnouncement, publishDueAnnouncements } from "../src/server/modules/announcements/service";
import { recomputeAttendance } from "../src/server/modules/attendance/compute";
import { requestRegularization } from "../src/server/modules/attendance/regularization";
import { seedDefaultShift } from "../src/server/modules/attendance/shifts";
import { submitCompOffClaim } from "../src/server/modules/compoff/service";
import { seedDefaultChecklistTemplates } from "../src/server/modules/employees/checklists";
import { submitProfileChange } from "../src/server/modules/employees/profile-changes";
import { updateEmployeeBank } from "../src/server/modules/employees/service";
import { saveUpload } from "../src/server/modules/files/service";
import { createHoliday, listHolidays, selectOptionalHoliday, setYearConfig } from "../src/server/modules/holidays/service";
import { leaveYearStartMonth, syncEntitlements } from "../src/server/modules/leave/ledger";
import { applyLeave, applyLeaveOnBehalf } from "../src/server/modules/leave/requests";
import { listLeaveTypes, seedDefaultLeaveTypes } from "../src/server/modules/leave/types";
import { createDepartment, createDesignation } from "../src/server/modules/org/service";
import { approveClaim, saveClaim, submitClaim } from "../src/server/modules/payroll/claims";
import { createLoan } from "../src/server/modules/payroll/loans";
import { prepareRelease, releaseRun, type PayslipEnv } from "../src/server/modules/payroll/payslips";
import { approveRun, computeRun, createRun, markPaid } from "../src/server/modules/payroll/runs";
import { reviseSalary } from "../src/server/modules/payroll/salaries";
import { listStructures, seedPayrollDefaults } from "../src/server/modules/payroll/structures";
import { listCategories } from "../src/server/modules/projects/queries";
import { addMembers, createClient, createProject, seedTimesheetDefaults } from "../src/server/modules/projects/service";
import { getSetting, patchSetting } from "../src/server/modules/settings/service";
import { approveTimesheet, saveWeek, submitTimesheet } from "../src/server/modules/timesheets/service";
import { createUser, getUserById, hashPassword, loadSessionUser } from "../src/server/modules/users/service";

export const DEMO_PASSWORD = "Demo-Pass-123";

type Person = {
  key: string; last: string; dept: string; title: string; roles: Role[]; joined: ISODate; dob: ISODate; gender: "male" | "female";
  ctc: number; manager?: string; type?: "full_time" | "contract" | "intern"; exited?: ISODate; city?: string;
};

export interface DemoLogin {
  email: string;
  name: string;
  about: string;
}

export interface DemoSummary {
  today: ISODate;
  logins: DemoLogin[];
  /** What the scenario set up, in plain words with real dates, for the person running the walkthrough. */
  scenario: string[];
}

const day = (iso: ISODate) => formatDate(iso, { weekday: "short", day: "numeric", month: "short" });

/** Fixed-date holidays every year, plus 2026's festivals. HR edits the list in Leave → Holidays. */
function holidaysFor(year: number): [ISODate, string, "fixed" | "optional"][] {
  const list: [ISODate, string, "fixed" | "optional"][] = [
    [`${year}-01-26`, "Republic Day", "fixed"], [`${year}-05-01`, "Maharashtra Day", "fixed"], [`${year}-08-15`, "Independence Day", "fixed"],
    [`${year}-10-02`, "Gandhi Jayanti", "fixed"], [`${year}-12-25`, "Christmas", "fixed"],
    // Optional ones on fixed dates, so there are always some ahead to pick in the walkthrough.
    [`${year}-01-01`, "New Year's Day", "optional"], [`${year}-12-24`, "Christmas Eve", "optional"], [`${year}-12-31`, "New Year's Eve", "optional"],
  ];
  if (year === 2026) {
    list.push(
      ["2026-03-04", "Holi", "optional"], ["2026-08-28", "Raksha Bandhan", "optional"], ["2026-09-04", "Janmashtami", "optional"],
      ["2026-10-20", "Dussehra", "fixed"], ["2026-11-09", "Diwali", "fixed"], ["2026-11-24", "Guru Nanak Jayanti", "optional"],
    );
  }
  return list.sort((a, b) => a[0].localeCompare(b[0]));
}

/** A one-page PDF receipt, so claims have something real to open. */
async function receiptPdf(lines: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 360]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  lines.forEach((text, i) => page.drawText(text, { x: 24, y: 320 - i * 22, size: i === 0 ? 15 : 11, font: i === 0 ? bold : font }));
  return Buffer.from(await pdf.save());
}

export async function buildDemo(db: DB, { now, uploadDir, payslipEnv }: { now: Date; uploadDir: string; payslipEnv: PayslipEnv }): Promise<DemoSummary> {
  const hash = await hashPassword(DEMO_PASSWORD);
  seedDefaultChecklistTemplates(db);
  seedDefaultLeaveTypes(db);
  seedDefaultShift(db, { attendanceMode: "punch" });
  seedTimesheetDefaults(db);
  seedPayrollDefaults(db);

  const tz = getSetting(db, "locale").timezone;
  const today = todayInTimeZone(tz, now);
  const yesterday = addDays(today, -1);
  // Holidays for every year the history might touch (it starts at most four months back) and the next one.
  const years = [Number(today.slice(0, 4)) - 1, Number(today.slice(0, 4)), Number(today.slice(0, 4)) + 1];
  const fixedHolidays = new Set(years.flatMap((y) => holidaysFor(y).filter((h) => h[2] === "fixed").map((h) => h[0])));
  const isWorkingDay = (d: ISODate) => dayOfWeek(d) !== 0 && dayOfWeek(d) !== 6 && !fixedHolidays.has(d);
  /** The working days from `from` going forward (step 1) or back (step -1), `from` included. */
  const workingDays = (from: ISODate, step: 1 | -1, count: number) => {
    const out: ISODate[] = [];
    for (let d = from; out.length < count; d = addDays(d, step)) if (isWorkingDay(d)) out.push(d);
    return out;
  };
  const lastSaturday = (before: ISODate) => {
    let d = addDays(before, -1);
    while (dayOfWeek(d) !== 6) d = addDays(d, -1);
    return d;
  };
  const fyStartMonth = getSetting(db, "locale").fiscalYearStartMonth;
  const fyStart = (() => {
    const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
    return `${m >= fyStartMonth ? y : y - 1}-${String(fyStartMonth).padStart(2, "0")}-01`;
  })();
  const leaveStartMonth = leaveYearStartMonth(db);
  const leaveYear = leaveYearOf(today, leaveStartMonth);
  const leaveYearStart = `${leaveYear}-${String(leaveStartMonth).padStart(2, "0")}-01`;
  const sameLeaveYear = (d: ISODate) => leaveYearOf(d, leaveStartMonth) === leaveYear;

  // The scenario's special days.
  const ashaAbsent = workingDays(addDays(today, -2), -1, 1)[0]!; // forgot to clock in: she asks for a correction
  const ashaSaturday = lastSaturday(today); // worked: she claims comp-off
  const rohanSaturday = addDays(ashaSaturday, -7); // worked: his comp-off claim waits for Neha
  const devInOnly = workingDays(addDays(today, -12), -1, 1)[0]!; // clocked in, never out: his correction waits for Ravi
  const special = new Set([ashaAbsent, devInOnly]);
  // Two paid payroll months, both over before the scenario's days: an approved run locks its attendance. Early in a
  // month that leaves last month's payroll still to run, as it would be.
  const earliest = [ashaAbsent, devInOnly, ashaSaturday, rohanSaturday].sort()[0]!;
  let runB = addMonths(periodOf(today), -1);
  while (monthRange(runB).end >= earliest) runB = addMonths(runB, -1);
  const runA = addMonths(runB, -1);
  const nextRun = addMonths(runB, 1);
  const historyStart = monthRange(runA).start;
  const exitDate = `${runB}-15`;
  const priyaJoined = workingDays(addDays(today, -20), 1, 1)[0]!;

  const admin = createUser(db, { email: "admin@pvcon.in", name: "System Admin", roles: ["super_admin"], passwordHash: hash, mustChangePassword: false });
  const actor = (userId: number) => loadSessionUser(db, userId, getUserById(db, userId)!.sessionVersion)!;
  const upload = (data: Buffer, name: string, uploadedBy: number) =>
    saveUpload(db, { data, originalName: name, allowed: ["png", "jpeg", "pdf"], uploadedBy, uploadDir, maxBytes: 10 * 1024 * 1024 });

  // ── Company ──────────────────────────────────────────────────────────────────────────────────────────────────
  const logo = upload(readFileSync("public/brand/favicon_io (1)/android-chrome-512x512.png"), "pvcon-logo.png", admin.id);
  patchSetting(db, "company", { legalName: "PVCON Consulting LLP", displayName: "PVCON Consulting", address: "4th Floor, Baner Road, Pune 411045", logoFileId: logo.id }, admin.id);
  patchSetting(db, "payroll", { signatoryEnabled: true, signatoryName: "Arjun Mehta", signatoryDesignation: "Director", payslipFooter: "This is a computer-generated payslip." }, admin.id);
  const dept = Object.fromEntries(
    [["Management", "MGMT"], ["Engineering", "ENG"], ["Consulting", "CONS"], ["Sales", "SALES"], ["Human Resources", "HR"], ["Finance", "FIN"]].map(([name, code]) => [
      code, createDepartment(db, { name: name!, code: code!, parentId: null, headEmployeeId: null }).id,
    ]),
  ) as Record<string, number>;
  const desig = Object.fromEntries(
    ["Director", "Engineering Manager", "Consulting Lead", "HR & Payroll Manager", "Senior Software Engineer", "Software Engineer", "QA Engineer",
      "Senior Consultant", "Consultant", "Sales Executive", "Accounts Executive", "Software Engineering Intern"].map((name, i) => [name, createDesignation(db, { name, level: i < 4 ? 3 : 1 }).id]),
  ) as Record<string, number>;

  // ── People ───────────────────────────────────────────────────────────────────────────────────────────────────
  const people: Person[] = [
    { key: "Arjun", last: "Mehta", dept: "MGMT", title: "Director", roles: ["employee", "manager"], joined: "2019-04-01", dob: "1978-11-02", gender: "male", ctc: 3_600_000 },
    { key: "Hema", last: "Shah", dept: "HR", title: "HR & Payroll Manager", roles: ["employee", "hr_admin", "payroll_admin"], joined: "2021-06-14", dob: "1986-03-19", gender: "female", ctc: 1_800_000, manager: "Arjun" },
    { key: "Ravi", last: "Kumar", dept: "ENG", title: "Engineering Manager", roles: ["employee", "manager"], joined: "2020-01-06", dob: "1984-10-29", gender: "male", ctc: 2_400_000, manager: "Arjun" },
    { key: "Asha", last: "Rao", dept: "ENG", title: "Senior Software Engineer", roles: ["employee"], joined: "2022-10-27", dob: "1994-02-11", gender: "female", ctc: 1_500_000, manager: "Ravi" },
    { key: "Kiran", last: "Das", dept: "ENG", title: "Software Engineer", roles: ["employee"], joined: "2024-02-12", dob: "1998-07-23", gender: "male", ctc: 900_000, manager: "Ravi" },
    { key: "Dev", last: "Patel", dept: "ENG", title: "QA Engineer", roles: ["employee"], joined: "2023-08-21", dob: "1996-11-05", gender: "male", ctc: 800_000, manager: "Ravi" },
    { key: "Priya", last: "Nair", dept: "ENG", title: "Software Engineering Intern", roles: ["employee"], joined: priyaJoined, dob: "2003-05-14", gender: "female", ctc: 360_000, manager: "Ravi", type: "intern" },
    { key: "Neha", last: "Kapoor", dept: "CONS", title: "Consulting Lead", roles: ["employee", "manager"], joined: "2020-09-01", dob: "1987-01-30", gender: "female", ctc: 2_200_000, manager: "Arjun" },
    { key: "Rohan", last: "Iyer", dept: "CONS", title: "Senior Consultant", roles: ["employee"], joined: "2022-03-07", dob: "1992-12-08", gender: "male", ctc: 1_400_000, manager: "Neha" },
    { key: "Sara", last: "Khan", dept: "CONS", title: "Consultant", roles: ["employee"], joined: "2025-01-13", dob: "1997-10-31", gender: "female", ctc: 1_000_000, manager: "Neha", type: "contract", city: "Mumbai" },
    { key: "Vikram", last: "Singh", dept: "SALES", title: "Sales Executive", roles: ["employee"], joined: "2023-04-17", dob: "1993-06-21", gender: "male", ctc: 720_000, manager: "Arjun", city: "Bengaluru" },
    { key: "Meera", last: "Joshi", dept: "FIN", title: "Accounts Executive", roles: ["employee"], joined: "2024-07-01", dob: "1995-09-09", gender: "female", ctc: 660_000, manager: "Arjun" },
    { key: "Karan", last: "Malhotra", dept: "SALES", title: "Sales Executive", roles: ["employee"], joined: "2024-03-01", dob: "1991-01-17", gender: "male", ctc: 700_000, manager: "Arjun", exited: exitDate },
  ];
  const emp: Record<string, EmployeeRow> = {};
  const uid: Record<string, number> = {};
  people.forEach((p, i) => {
    const email = `${p.key.toLowerCase()}@pvcon.in`;
    const user = createUser(db, { email, name: `${p.key} ${p.last}`, roles: p.roles, passwordHash: hash, mustChangePassword: false });
    if (p.exited) db.update(users).set({ status: "disabled" }).where(eq(users.id, user.id)).run();
    uid[p.key] = user.id;
    // Karan is recorded as active until his salary history is in, then leaves (see below).
    emp[p.key] = db
      .insert(employees)
      .values({
        employeeCode: `PV${String(i + 1).padStart(4, "0")}`, firstName: p.key, lastName: p.last, displayName: `${p.key} ${p.last}`, workEmail: email,
        phone: `+91 98${String(20000000 + i * 1234567).slice(0, 8)}`, dateOfBirth: p.dob, gender: p.gender, departmentId: dept[p.dept], designationId: desig[p.title],
        reportingManagerId: p.manager ? emp[p.manager]!.id : null, employmentType: p.type ?? "full_time", workLocation: p.city ?? "Pune",
        dateOfJoining: p.joined, confirmationDate: p.type === "intern" ? null : addDays(p.joined, 180), probationEndDate: addDays(p.joined, 180),
        status: "active", lastWorkingDate: p.exited ?? null, exitReason: p.exited ? "Resigned: moved to another city" : null, userId: user.id,
      })
      .returning()
      .get();
    updateEmployeeBank(db, emp[p.key]!.id, {
      bankName: i % 2 ? "HDFC Bank" : "ICICI Bank", bankAccount: `5010004${String(1000000 + i * 7919).slice(0, 7)}`, bankIfsc: i % 2 ? "HDFC0001234" : "ICIC0000456",
      pan: `ABCPM${String(1000 + i * 37).slice(0, 4)}K`, aadhaar: null, passport: null,
    });
  });
  const A = (key: string) => actor(uid[key]!);
  const sysAdmin = actor(admin.id);
  const current = people.filter((p) => !p.exited);

  // ── Holidays and leave ───────────────────────────────────────────────────────────────────────────────────────
  for (const year of years) {
    for (const [date, name, type] of holidaysFor(year)) createHoliday(db, { date, name, type });
    setYearConfig(db, year, 2);
  }
  // Adding past holidays computes those dates for everyone; the company's history starts with the first payroll month.
  db.delete(attendanceDays).where(lt(attendanceDays.date, historyStart)).run();
  for (const p of current) syncEntitlements(db, emp[p.key]!.id, today);
  syncEntitlements(db, emp.Karan!.id, exitDate);
  const nextOptional = listHolidays(db, Number(today.slice(0, 4))).find((h) => h.type === "optional" && h.date > today);
  if (nextOptional) for (const key of ["Asha", "Rohan"]) selectOptionalHoliday(db, emp[key]!.id, nextOptional.id, true, today);

  const type = Object.fromEntries(listLeaveTypes(db).map((t) => [t.code, t.id]));
  // Past leave, recorded by HR, spread over this leave year's part of the history.
  const pastPool = eachDay(historyStart > leaveYearStart ? historyStart : leaveYearStart, addDays(today, -3)).filter((d) => isWorkingDay(d) && !special.has(d));
  const leaveDays = new Set<string>();
  const past: [string, string, number, number, ("first_half" | "full")?][] = [
    ["Hema", "CL", 0.08, 2], ["Meera", "SL", 0.15, 1], ["Kiran", "CL", 0.3, 2], ["Neha", "CL", 0.45, 1], ["Asha", "CL", 0.55, 2],
    ["Rohan", "SL", 0.65, 1], ["Dev", "CL", 0.72, 1], ["Vikram", "CL", 0.8, 2], ["Sara", "CL", 0.88, 1, "first_half"],
  ];
  for (const [key, code, at, count, half = "full"] of past) {
    const start = pastPool[Math.floor(at * pastPool.length)];
    if (!start) continue;
    const end = workingDays(start, 1, count)[count - 1]!;
    if (end >= today || !sameLeaveYear(end) || eachDay(start, end).some((d) => special.has(d))) continue;
    applyLeaveOnBehalf(db, sysAdmin, {
      employeeId: emp[key]!.id, leaveTypeId: type[code]!, startDate: start, endDate: end, startHalf: half, endHalf: half,
      reason: code === "SL" ? "Unwell" : "Family function",
    }, { today, attachmentFileId: null });
    if (half === "full") for (const d of eachDay(start, end)) leaveDays.add(`${key}:${d}`);
  }
  if (isWorkingDay(today)) {
    applyLeaveOnBehalf(db, sysAdmin, { employeeId: emp.Meera!.id, leaveTypeId: type.CL!, startDate: today, endDate: today, startHalf: "full", endHalf: "full", reason: "Personal work" }, { today, attachmentFileId: null });
    leaveDays.add(`Meera:${today}`);
  }

  // ── Attendance: punches for every working day of the history ─────────────────────────────────────────────────
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const punch = (key: string, date: ISODate, inMin: number, outMin: number | null, mode: "office" | "remote") => {
    const employeeId = emp[key]!.id;
    db.insert(attendancePunches).values({ employeeId, at: zonedInstant(date, inMin, tz).toISOString(), date, direction: "in", workMode: mode }).run();
    if (outMin !== null) db.insert(attendancePunches).values({ employeeId, at: zonedInstant(date, outMin, tz).toISOString(), date, direction: "out", workMode: mode }).run();
  };
  for (const p of people) {
    const from = p.joined > historyStart ? p.joined : historyStart;
    for (const date of eachDay(from, p.exited ?? yesterday)) {
      if (!isWorkingDay(date) || leaveDays.has(`${p.key}:${date}`) || (p.key === "Asha" && date === ashaAbsent)) continue;
      const remote = dayOfWeek(date) === 5 && ["ENG", "CONS"].includes(p.dept) && !p.roles.includes("manager");
      const inMin = 9 * 60 + 18 + Math.floor(rand() * 40);
      punch(p.key, date, inMin, p.key === "Dev" && date === devInOnly ? null : 18 * 60 + 25 + Math.floor(rand() * 75), remote ? "remote" : "office");
    }
  }
  punch("Asha", ashaSaturday, 10 * 60, 16 * 60 + 15, "remote");
  punch("Rohan", rohanSaturday, 10 * 60, 18 * 60 + 40, "office");
  // This morning: whoever would already be in has clocked in. Asha clocks in herself in the walkthrough.
  if (isWorkingDay(today)) {
    const nowMinutes = minutesInZone(now, tz);
    for (const p of current) {
      if (["Asha", "Arjun", "Meera"].includes(p.key) || p.joined > today) continue;
      const inMin = 8 * 60 + 52 + Math.floor(rand() * 30);
      const mode = ["ENG", "CONS"].includes(p.dept) && !p.roles.includes("manager") ? "remote" : "office";
      if (inMin < nowMinutes) punch(p.key, today, inMin, null, mode);
      // Kiran stepped out ten minutes ago, so Ravi's Today board has someone on a break.
      if (p.key === "Kiran" && nowMinutes - 10 >= inMin + 45) {
        db.insert(attendancePunches)
          .values({ employeeId: emp.Kiran!.id, at: zonedInstant(today, nowMinutes - 10, tz).toISOString(), date: today, direction: "out", workMode: mode, startsBreak: true })
          .run();
      }
    }
  }
  for (const e of Object.values(emp)) recomputeAttendance(db, e.id, historyStart, yesterday, { now });

  // ── Projects and timesheets ──────────────────────────────────────────────────────────────────────────────────
  const acme = createClient(db, { name: "Acme Retail", code: "ACME" });
  const globex = createClient(db, { name: "Globex Bank", code: "GLOBEX" });
  const portal = createProject(db, { name: "Acme e-commerce portal", code: "ACME-PORTAL", clientId: acme.id, billableDefault: true, status: "active", startDate: addDays(historyStart, -120), endDate: null, budgetHours: 2400, managerEmployeeId: emp.Ravi!.id });
  const analytics = createProject(db, { name: "Globex risk analytics", code: "GLX-RISK", clientId: globex.id, billableDefault: true, status: "active", startDate: addDays(historyStart, -60), endDate: addDays(today, 90), budgetHours: 1200, managerEmployeeId: emp.Neha!.id });
  createProject(db, { name: "Website refresh", code: "WEB-REFRESH", clientId: null, billableDefault: false, status: "on_hold", startDate: null, endDate: null, budgetHours: 200, managerEmployeeId: emp.Ravi!.id });
  addMembers(db, portal.id, ["Ravi", "Asha", "Kiran", "Dev", "Priya"].map((k) => emp[k]!.id), null);
  addMembers(db, analytics.id, ["Neha", "Rohan", "Sara"].map((k) => emp[k]!.id), null);
  const internal = db.select().from(projects).all().find((p) => p.code === "INT")!;
  const cat = Object.fromEntries(listCategories(db, {}).map((c) => [c.name, c.id]));
  const plan: Record<string, [number, number, number][]> = {
    Ravi: [[portal.id, cat.Meetings!, 180], [internal.id, cat["Internal admin"]!, 240]],
    Asha: [[portal.id, cat.Development!, 390], [internal.id, cat.Meetings!, 60]],
    Kiran: [[portal.id, cat.Development!, 360], [portal.id, cat.Meetings!, 60]],
    Dev: [[portal.id, cat.Testing!, 375], [internal.id, cat.Meetings!, 45]],
    Priya: [[portal.id, cat.Development!, 300], [internal.id, cat.Training!, 120]],
    Neha: [[analytics.id, cat.Meetings!, 240], [analytics.id, cat.Documentation!, 120], [internal.id, cat["Internal admin"]!, 60]],
    Rohan: [[analytics.id, cat.Documentation!, 330], [analytics.id, cat.Meetings!, 90]],
    Sara: [[analytics.id, cat.Documentation!, 300], [internal.id, cat.Training!, 60]],
  };
  const approver: Record<string, string> = { Ravi: "Arjun", Neha: "Arjun", Asha: "Ravi", Kiran: "Ravi", Dev: "Ravi", Priya: "Ravi", Rohan: "Neha", Sara: "Neha" };
  const lastWeek = addDays(startOfWeek(today), -7);
  const firstWeek = dayOfWeek(historyStart) === 1 ? historyStart : addDays(startOfWeek(historyStart), 7);
  for (let week = firstWeek; week <= lastWeek; week = addDays(week, 7)) {
    for (const [key, rows] of Object.entries(plan)) {
      if (key === "Asha" && week === lastWeek) continue; // she fills it in during the walkthrough
      const p = people.find((x) => x.key === key)!;
      const days = eachDay(week, addDays(week, 4)).filter((d) => d >= p.joined && isWorkingDay(d) && !leaveDays.has(`${key}:${d}`) && !(key === "Asha" && d === ashaAbsent));
      if (!days.length) continue;
      saveWeek(db, A(key), {
        weekStart: week,
        rows: rows.map(([projectId, taskCategoryId, minutes]) => ({ projectId, taskCategoryId, billable: projectId !== internal.id, notes: "", minutes: Object.fromEntries(days.map((d) => [d, minutes])) })),
      }, { today });
      const sheet = submitTimesheet(db, A(key), week, { today, now });
      if (!(week === lastWeek && ["Kiran", "Dev", "Rohan"].includes(key))) approveTimesheet(db, A(approver[key]!), sheet.id, null);
    }
  }

  // ── Salaries, claims, a loan, and two paid payroll runs ──────────────────────────────────────────────────────
  const structureId = listStructures(db)[0]!.id;
  // This year's appraisal, or last year's if this financial year started after the history did.
  const yearBack = (iso: ISODate) => `${Number(iso.slice(0, 4)) - 1}${iso.slice(4)}`;
  const salaryStart = fyStart <= historyStart ? fyStart : yearBack(fyStart);
  reviseSalary(db, uid.Hema!, { employeeId: emp.Asha!.id, effectiveFrom: yearBack(salaryStart), annualCtc: 1_250_000 * 100, structureId, overrides: {}, reason: "Annual appraisal" });
  for (const p of people) {
    const joinedLater = p.joined > salaryStart;
    reviseSalary(db, uid.Hema!, {
      employeeId: emp[p.key]!.id, effectiveFrom: joinedLater ? `${p.joined.slice(0, 7)}-01` : salaryStart, annualCtc: p.ctc * 100, structureId, overrides: {},
      reason: joinedLater ? "Joining offer" : "Annual appraisal",
    });
  }
  db.update(employees).set({ status: "exited" }).where(eq(employees.id, emp.Karan!.id)).run();

  const kiranReceipt = upload(await receiptPdf(["City Cabs Pune", "Trip receipt", `Date: ${day(`${runB}-10`)}`, "Baner to Hinjewadi and back", "Total paid: Rs. 1,850.00"]), "cab-receipt.pdf", uid.Kiran!);
  const kiranClaim = saveClaim(db, A("Kiran"), null, { category: "travel", claimDate: `${runB}-10`, amount: 185_000, description: "Cab to the Acme office for the release", receiptFileId: kiranReceipt.id }, { today, now });
  submitClaim(db, A("Kiran"), kiranClaim.id, { today, now });
  approveClaim(db, A("Ravi"), kiranClaim.id, null, { today, now });
  createLoan(db, uid.Hema!, { employeeId: emp.Rohan!.id, type: "advance", principal: 3_000_000, emi: 1_000_000, startPeriod: runB, note: "Relocation advance" });

  for (const run of [runA, runB]) {
    const created = createRun(db, uid.Hema!, { period: run, type: "regular", notes: null }, { today });
    db.transaction((tx) => computeRun(tx, uid.Hema!, created.id, { today, now }));
    db.transaction((tx) => approveRun(tx, admin.id, created.id, { now }));
    const prepared = await prepareRelease(db, created.id, payslipEnv, { now });
    db.transaction((tx) => releaseRun(tx, created.id, prepared, { now, uploadDir }));
    db.transaction((tx) => markPaid(tx, created.id, { paidOn: monthRange(run).end, reference: `NEFT/${run.replace("-", "")}` }, { now }));
  }

  // ── Something waiting in every inbox ─────────────────────────────────────────────────────────────────────────
  const scenario: string[] = [];
  const kiranLeave = workingDays(addDays(today, 5), 1, 2);
  if (sameLeaveYear(kiranLeave[1]!)) {
    applyLeave(db, A("Kiran"), { leaveTypeId: type.CL!, startDate: kiranLeave[0]!, endDate: kiranLeave[1]!, startHalf: "full", endHalf: "full", reason: "Sister's wedding" }, { today, attachmentFileId: null });
    scenario.push(`Ravi: Kiran's casual leave ${day(kiranLeave[0]!)}–${day(kiranLeave[1]!)} waits for approval.`);
  }
  const meeraLeave = workingDays(addDays(today, 8), 1, 2);
  if (sameLeaveYear(meeraLeave[1]!)) {
    applyLeave(db, A("Meera"), { leaveTypeId: type.CL!, startDate: meeraLeave[0]!, endDate: meeraLeave[1]!, startHalf: "full", endHalf: "full", reason: "Family trip" }, { today, attachmentFileId: null });
    scenario.push(`Arjun: Meera's casual leave ${day(meeraLeave[0]!)}–${day(meeraLeave[1]!)} waits for approval.`);
  }
  requestRegularization(db, A("Dev"), { date: devInOnly, requestedIn: 9 * 60 + 35, requestedOut: 18 * 60 + 40, reason: "Forgot to clock out after the release call" }, { today });
  scenario.push(`Ravi: Dev's attendance correction for ${day(devInOnly)} (he clocked in but never out), and Kiran's and Dev's timesheets for the week of ${day(lastWeek)}.`);
  submitCompOffClaim(db, A("Rohan"), { workedDate: rohanSaturday, reason: "Go-live support on Saturday" }, { today });
  const saraDate = workingDays(addDays(today, -3), -1, 1)[0]!;
  const saraReceipt = upload(await receiptPdf(["Spice Route Kitchen", "Tax invoice", `Date: ${day(saraDate)}`, "Working lunch, 4 guests", "Total: Rs. 2,400.00"]), "client-lunch.pdf", uid.Sara!);
  const saraClaim = saveClaim(db, A("Sara"), null, { category: "meals", claimDate: saraDate, amount: 240_000, description: "Working lunch with the Globex team", receiptFileId: saraReceipt.id }, { today, now });
  submitClaim(db, A("Sara"), saraClaim.id, { today, now });
  scenario.push(`Neha: Rohan's comp-off claim for ${day(rohanSaturday)}, Rohan's timesheet for the week of ${day(lastWeek)}, and Sara's ₹2,400 lunch claim.`);
  submitProfileChange(db, emp.Vikram!.id, uid.Vikram!, { bankName: "Axis Bank", bankAccount: "917010045678123", bankIfsc: "UTIB0000123", pan: "ABCPV1234K", aadhaar: null, passport: null }, "Salary account moved to Axis Bank");
  scenario.push("Hema (HR): Vikram's request to change his bank account to Axis Bank.");
  scenario.unshift(
    `Asha: forgot to clock in on ${day(ashaAbsent)} (shows Absent), worked on ${day(ashaSaturday)} (comp-off to claim), and her timesheet for the week of ${day(lastWeek)} is empty.`,
  );
  scenario.push(`Payroll: ${formatPeriodLong(runA)} and ${formatPeriodLong(runB)} are paid; ${formatPeriodLong(nextRun)} is ready to run. Karan left on ${day(exitDate)}; Priya joined on ${day(priyaJoined)}.`);
  if (isWorkingDay(today)) scenario.push("Meera is on leave today; Arjun hasn't come in.");

  createAnnouncement(db, uid.Hema!, {
    title: "Welcome to PVCON People",
    body: "This is where you now clock in, apply for leave, fill in timesheets, claim expenses and get your payslips. Check your profile and leave balances, and tell HR if anything looks wrong.",
    pinned: true, publishOn: addDays(today, -2), showUntil: addDays(today, 30),
  }, { now, timeZone: tz });
  const outing = workingDays(addDays(today, 10), 1, 1)[0]!;
  createAnnouncement(db, uid.Hema!, {
    title: `Team outing on ${formatDate(outing, { weekday: "long", day: "numeric", month: "long" })}`,
    body: "Lunch and an afternoon of games at the Baner clubhouse, from 1 pm. Tell Hema about any food preferences by the end of this week.",
    pinned: false, publishOn: addDays(today, -1), showUntil: outing,
  }, { now, timeZone: tz });
  publishDueAnnouncements(db, now);
  // The history's notifications are old news: only announcements stay unread, so new ones stand out.
  db.update(notifications).set({ readAt: now.toISOString() }).where(and(isNull(notifications.readAt), ne(notifications.type, "announcement.published"))).run();

  const logins: DemoLogin[] = [
    { email: "admin@pvcon.in", name: "System Admin", about: "Super admin: settings, users and roles, approves payroll runs" },
    { email: "hema@pvcon.in", name: "Hema Shah", about: "HR admin and payroll admin" },
    { email: "arjun@pvcon.in", name: "Arjun Mehta", about: "Director: manages Hema, Ravi, Neha, Vikram and Meera" },
    { email: "ravi@pvcon.in", name: "Ravi Kumar", about: "Manager: Engineering (Asha, Kiran, Dev, Priya)" },
    { email: "neha@pvcon.in", name: "Neha Kapoor", about: "Manager: Consulting (Rohan, Sara)" },
    { email: "asha@pvcon.in", name: "Asha Rao", about: "Employee: Senior Software Engineer, reports to Ravi" },
    { email: "kiran@pvcon.in", name: "Kiran Das", about: "Employee, reports to Ravi" },
    { email: "rohan@pvcon.in", name: "Rohan Iyer", about: "Employee, reports to Neha (has a salary advance)" },
    { email: "priya@pvcon.in", name: "Priya Nair", about: "Intern who joined three weeks ago, reports to Ravi" },
  ];
  return { today, logins, scenario };
}

function formatPeriodLong(period: string): string {
  return formatDate(`${period}-01`, { month: "long", year: "numeric" });
}
