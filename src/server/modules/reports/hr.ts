import { and, inArray, lte } from "drizzle-orm";
import { pushTo } from "@/lib/collections";
import { addMonths, diffDays, formatPeriod, monthRange } from "@/lib/dates";
import { EMPLOYEE_STATUS_LABELS, EMPLOYMENT_TYPE_LABELS, GENDER_LABELS } from "@/lib/hr";
import { employees } from "@/server/db/schema";
import { bankView } from "@/server/modules/employees/sensitive";
import { upcomingCelebrations } from "@/server/modules/dashboard/queries";
import { percent, reportEmployees } from "./common";
import type { ReportDefinition } from "./types";

const HR = { area: "hr", permissions: ["report.hr"], orgWide: "employee.view" } as const;

export const hrReports: ReportDefinition[] = [
  {
    ...HR,
    slug: "headcount",
    title: "Headcount",
    description: "Employees on a date by department, with average tenure.",
    filters: ["date", "department"],
    run: (db, ctx, p) => {
      const people = reportEmployees(db, ctx, { departmentId: p.departmentId, from: p.date, to: p.date });
      const groups = new Map<string, typeof people>();
      for (const e of people) pushTo(groups, e.department ?? "No department", e);
      const rows = [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([department, list]) => ({
          department,
          headcount: list.length,
          fullTime: list.filter((e) => e.employmentType === "full_time").length,
          other: list.filter((e) => e.employmentType !== "full_time").length,
          tenure: Math.round((list.reduce((s, e) => s + diffDays(e.dateOfJoining, p.date), 0) / list.length / 365.25) * 10) / 10,
        }));
      return {
        columns: [
          { key: "department", label: "Department", type: "text" }, { key: "headcount", label: "Headcount", type: "number" },
          { key: "fullTime", label: "Full-time", type: "number" }, { key: "other", label: "Other types", type: "number" },
          { key: "tenure", label: "Average tenure (years)", type: "number" },
        ],
        rows,
        chart: { type: "bar", x: "department", series: [{ key: "headcount", label: "Headcount" }] },
        note: `${people.length} employee(s) in total.`,
      };
    },
  },
  {
    ...HR,
    slug: "joiners-leavers",
    title: "Joiners and leavers",
    description: "Who joined or left between two dates.",
    filters: ["range", "department"],
    run: (db, ctx, p) => {
      const people = reportEmployees(db, ctx, { departmentId: p.departmentId });
      const rows = [
        ...people.filter((e) => e.dateOfJoining >= p.from && e.dateOfJoining <= p.to).map((e) => ({ ...e, event: "Joined", date: e.dateOfJoining })),
        ...people.filter((e) => e.lastWorkingDate && e.lastWorkingDate >= p.from && e.lastWorkingDate <= p.to).map((e) => ({ ...e, event: "Left", date: e.lastWorkingDate! })),
      ]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((e) => ({ date: e.date, event: e.event, code: e.employeeCode, name: e.displayName, department: e.department, designation: e.designation }));
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "event", label: "Event", type: "text" }, { key: "code", label: "Code", type: "text" },
          { key: "name", label: "Name", type: "text" }, { key: "department", label: "Department", type: "text" }, { key: "designation", label: "Designation", type: "text" },
        ],
        rows,
      };
    },
  },
  {
    ...HR,
    slug: "attrition",
    title: "Attrition",
    description: "Leavers per month over the last twelve months, as a share of average headcount.",
    filters: ["department"],
    run: (db, ctx, p) => {
      const people = reportEmployees(db, ctx, { departmentId: p.departmentId });
      const current = ctx.today.slice(0, 7);
      const at = (date: string) => people.filter((e) => e.dateOfJoining <= date && !(e.lastWorkingDate && e.lastWorkingDate < date) && !(e.status === "exited" && !e.lastWorkingDate)).length;
      const rows = Array.from({ length: 12 }, (_, i) => addMonths(current, i - 11)).map((period) => {
        const { start, end } = monthRange(period);
        const opening = at(start);
        const closing = at(period === current ? ctx.today : end);
        const leavers = people.filter((e) => e.lastWorkingDate && e.lastWorkingDate >= start && e.lastWorkingDate <= end).length;
        const joiners = people.filter((e) => e.dateOfJoining >= start && e.dateOfJoining <= end).length;
        return { month: formatPeriod(period), opening, joiners, leavers, closing, attrition: percent(leavers, (opening + closing) / 2) };
      });
      return {
        columns: [
          { key: "month", label: "Month", type: "text" }, { key: "opening", label: "Opening", type: "number" }, { key: "joiners", label: "Joined", type: "number" },
          { key: "leavers", label: "Left", type: "number" }, { key: "closing", label: "Closing", type: "number" }, { key: "attrition", label: "Attrition", type: "percent" },
        ],
        rows,
        chart: { type: "line", x: "month", series: [{ key: "attrition", label: "Attrition %" }] },
        note: "Attrition = leavers ÷ the average of the opening and closing headcount.",
      };
    },
  },
  {
    ...HR,
    slug: "employee-master",
    title: "Employee master",
    description: "Every employee with job and personal details; bank and ID numbers masked.",
    filters: ["department"],
    run: (db, ctx, p) => {
      const people = reportEmployees(db, ctx, { departmentId: p.departmentId });
      const names = new Map(people.length ? db.select({ id: employees.id, name: employees.displayName }).from(employees).all().map((e) => [e.id, e.name]) : []);
      return {
        columns: [
          { key: "code", label: "Code", type: "text" }, { key: "name", label: "Name", type: "text" }, { key: "status", label: "Status", type: "text" },
          { key: "department", label: "Department", type: "text" }, { key: "designation", label: "Designation", type: "text" },
          { key: "manager", label: "Reporting manager", type: "text" }, { key: "type", label: "Employment type", type: "text" },
          { key: "location", label: "Work location", type: "text" }, { key: "joined", label: "Joined", type: "date" },
          { key: "confirmed", label: "Confirmed", type: "date" }, { key: "lastDay", label: "Last working day", type: "date" },
          { key: "email", label: "Work email", type: "text" }, { key: "phone", label: "Phone", type: "text" }, { key: "dob", label: "Date of birth", type: "date" },
          { key: "gender", label: "Gender", type: "text" }, { key: "bank", label: "Bank", type: "text" }, { key: "account", label: "Account", type: "text" },
          { key: "ifsc", label: "IFSC", type: "text" }, { key: "pan", label: "PAN", type: "text" },
        ],
        rows: people.map((e) => {
          const bank = bankView(e, false);
          return {
            code: e.employeeCode, name: e.displayName, status: EMPLOYEE_STATUS_LABELS[e.status], department: e.department, designation: e.designation,
            manager: e.reportingManagerId ? (names.get(e.reportingManagerId) ?? null) : null, type: EMPLOYMENT_TYPE_LABELS[e.employmentType],
            location: e.workLocation, joined: e.dateOfJoining, confirmed: e.confirmationDate, lastDay: e.lastWorkingDate, email: e.workEmail, phone: e.phone,
            dob: e.dateOfBirth, gender: e.gender ? GENDER_LABELS[e.gender] : null, bank: bank.bankName, account: bank.bankAccount, ifsc: bank.bankIfsc,
            pan: bank.pan,
          };
        }),
      };
    },
  },
  {
    ...HR,
    slug: "celebrations",
    title: "Birthdays and work anniversaries",
    description: "Birthdays and work anniversaries in a month.",
    filters: ["period", "department"],
    run: (db, ctx, p) => {
      const { start, end } = monthRange(p.period);
      const allowed = new Set(reportEmployees(db, ctx, { departmentId: p.departmentId, where: and(inArray(employees.status, ["active", "on_notice"]), lte(employees.dateOfJoining, end)) }).map((e) => e.id));
      const rows = upcomingCelebrations(db, start, diffDays(start, end) + 1)
        .filter((c) => allowed.has(c.employeeId))
        .map((c) => ({ date: c.date, name: c.name, occasion: c.kind === "birthday" ? "Birthday" : "Work anniversary", years: c.years }));
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "name", label: "Name", type: "text" }, { key: "occasion", label: "Occasion", type: "text" },
          { key: "years", label: "Years", type: "number" },
        ],
        rows,
      };
    },
  },
];
