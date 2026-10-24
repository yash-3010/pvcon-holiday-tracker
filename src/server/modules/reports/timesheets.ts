import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { addDays, type ISODate } from "@/lib/dates";
import { PROJECT_STATUS_LABELS, TIMESHEET_STATUS_LABELS, utilization, weekRangeLabel } from "@/lib/timesheets";
import type { DbLike } from "@/server/db/client";
import { clients, employees, projects, taskCategories, timesheetEntries, timesheets, users } from "@/server/db/schema";
import { availableMinutes } from "@/server/modules/timesheets/availability";
import { percent, reportEmployees } from "./common";
import type { ReportContext, ReportDefinition } from "./types";

const TIMESHEETS = { area: "timesheets", permissions: ["report.timesheet"], orgWide: "timesheet.view.all" } as const;
const LOGGED_NOTE = "Hours come from submitted and approved weeks.";

/** Submitted and approved entries of the viewer's scope, optionally for a date range and one project. */
function loggedEntries(db: DbLike, ctx: ReportContext, { from, to, projectId = null }: { from?: ISODate; to?: ISODate; projectId?: number | null }) {
  if (ctx.scope !== null && ctx.scope.length === 0) return [];
  return db
    .select({
      employeeId: timesheets.employeeId, projectId: timesheetEntries.projectId, projectCode: projects.code, projectName: projects.name,
      clientId: projects.clientId, client: clients.name, category: taskCategories.name, minutes: timesheetEntries.minutes, billable: timesheetEntries.billable,
    })
    .from(timesheetEntries)
    .innerJoin(timesheets, eq(timesheets.id, timesheetEntries.timesheetId))
    .innerJoin(projects, eq(projects.id, timesheetEntries.projectId))
    .innerJoin(taskCategories, eq(taskCategories.id, timesheetEntries.taskCategoryId))
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .where(
      and(
        inArray(timesheets.status, ["submitted", "approved"]),
        ctx.scope === null ? undefined : inArray(timesheets.employeeId, ctx.scope),
        from ? gte(timesheetEntries.date, from) : undefined,
        to ? lte(timesheetEntries.date, to) : undefined,
        projectId === null ? undefined : eq(timesheetEntries.projectId, projectId),
      ),
    )
    .all();
}

type Entry = ReturnType<typeof loggedEntries>[number];
const totals = (list: Entry[]) => {
  const logged = list.reduce((s, e) => s + e.minutes, 0);
  const billable = list.reduce((s, e) => s + (e.billable ? e.minutes : 0), 0);
  return { logged, billable };
};
function groupBy<K>(list: Entry[], key: (e: Entry) => K): Map<K, Entry[]> {
  const groups = new Map<K, Entry[]>();
  for (const e of list) groups.set(key(e), [...(groups.get(key(e)) ?? []), e]);
  return groups;
}

export const timesheetsReports: ReportDefinition[] = [
  {
    ...TIMESHEETS,
    slug: "utilization",
    title: "Utilization",
    description: "Hours logged against hours available per person, and the billable share.",
    filters: ["range", "department"],
    run: (db, ctx, p) => {
      const people = reportEmployees(db, ctx, { departmentId: p.departmentId, from: p.from, to: p.to });
      const byPerson = groupBy(loggedEntries(db, ctx, { from: p.from, to: p.to }), (e) => e.employeeId);
      const rows = people.map((e) => {
        const { logged, billable } = totals(byPerson.get(e.id) ?? []);
        const available = availableMinutes(db, e.id, p.from, p.to);
        const { utilizationPct, billablePct } = utilization({ availableMinutes: available, loggedMinutes: logged, billableMinutes: billable });
        return { code: e.employeeCode, name: e.displayName, department: e.department, available, logged, billable, utilization: utilizationPct, billableShare: billablePct };
      });
      return {
        columns: [
          { key: "code", label: "Code", type: "text" }, { key: "name", label: "Name", type: "text" }, { key: "department", label: "Department", type: "text" },
          { key: "available", label: "Available", type: "minutes" }, { key: "logged", label: "Logged", type: "minutes" }, { key: "billable", label: "Billable", type: "minutes" },
          { key: "utilization", label: "Utilization", type: "percent" }, { key: "billableShare", label: "Billable share", type: "percent" },
        ],
        rows,
        chart: { type: "bar", x: "name", series: [{ key: "utilization", label: "Utilization %" }] },
        note: `Utilization = logged ÷ available hours (shift hours on working days, less leave and holidays). ${LOGGED_NOTE}`,
      };
    },
  },
  {
    ...TIMESHEETS,
    slug: "billable",
    title: "Billable share by department",
    description: "Billable and non-billable hours per department.",
    filters: ["range", "department"],
    run: (db, ctx, p) => {
      const people = new Map(reportEmployees(db, ctx, { departmentId: p.departmentId }).map((e) => [e.id, e.department ?? "No department"]));
      const entries = loggedEntries(db, ctx, { from: p.from, to: p.to }).filter((e) => people.has(e.employeeId));
      const rows = [...groupBy(entries, (e) => people.get(e.employeeId)!).entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([department, list]) => {
          const { logged, billable } = totals(list);
          return { department, people: new Set(list.map((e) => e.employeeId)).size, logged, billable, nonBillable: logged - billable, billableShare: percent(billable, logged) };
        });
      return {
        columns: [
          { key: "department", label: "Department", type: "text" }, { key: "people", label: "People", type: "number" }, { key: "logged", label: "Logged", type: "minutes" },
          { key: "billable", label: "Billable", type: "minutes" }, { key: "nonBillable", label: "Non-billable", type: "minutes" },
          { key: "billableShare", label: "Billable share", type: "percent" },
        ],
        rows,
        chart: { type: "bar", x: "department", series: [{ key: "billable", label: "Billable (minutes)" }, { key: "nonBillable", label: "Non-billable (minutes)" }] },
        note: `Billable share = billable ÷ logged hours. ${LOGGED_NOTE}`,
      };
    },
  },
  {
    ...TIMESHEETS,
    slug: "project-hours",
    title: "Project hours",
    description: "Hours per project, person and task category.",
    filters: ["range", "project", "department"],
    run: (db, ctx, p) => {
      const people = new Map(reportEmployees(db, ctx, { departmentId: p.departmentId }).map((e) => [e.id, e]));
      const entries = loggedEntries(db, ctx, { from: p.from, to: p.to, projectId: p.projectId }).filter((e) => people.has(e.employeeId));
      const rows = [...groupBy(entries, (e) => `${e.projectCode}\u0000${people.get(e.employeeId)!.employeeCode}\u0000${e.category}`).values()]
        .map((list) => {
          const [first] = list as [Entry];
          const { logged, billable } = totals(list);
          return { project: first.projectCode, projectName: first.projectName, client: first.client ?? "Internal", name: people.get(first.employeeId)!.displayName, category: first.category, logged, billable };
        })
        .sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name) || a.category.localeCompare(b.category));
      return {
        columns: [
          { key: "project", label: "Project", type: "text" }, { key: "projectName", label: "Project name", type: "text" }, { key: "client", label: "Client", type: "text" },
          { key: "name", label: "Person", type: "text" }, { key: "category", label: "Category", type: "text" }, { key: "logged", label: "Hours", type: "minutes" },
          { key: "billable", label: "Billable", type: "minutes" },
        ],
        rows,
        note: LOGGED_NOTE,
      };
    },
  },
  {
    ...TIMESHEETS,
    slug: "client-hours",
    title: "Client hours",
    description: "Hours per client across their projects.",
    filters: ["range"],
    run: (db, ctx, p) => {
      const rows = [...groupBy(loggedEntries(db, ctx, { from: p.from, to: p.to }), (e) => e.client ?? "Internal").entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([client, list]) => {
          const { logged, billable } = totals(list);
          return { client, projects: new Set(list.map((e) => e.projectId)).size, people: new Set(list.map((e) => e.employeeId)).size, logged, billable, billableShare: percent(billable, logged) };
        });
      return {
        columns: [
          { key: "client", label: "Client", type: "text" }, { key: "projects", label: "Projects", type: "number" }, { key: "people", label: "People", type: "number" },
          { key: "logged", label: "Hours", type: "minutes" }, { key: "billable", label: "Billable", type: "minutes" }, { key: "billableShare", label: "Billable share", type: "percent" },
        ],
        rows,
        chart: { type: "bar", x: "client", series: [{ key: "logged", label: "Hours (minutes)" }] },
        note: `Internal = projects without a client. ${LOGGED_NOTE}`,
      };
    },
  },
  {
    ...TIMESHEETS,
    slug: "budget-burn",
    title: "Budget burn",
    description: "Hours booked to date against each project's budget.",
    filters: ["project"],
    run: (db, ctx, p) => {
      const list = db
        .select({ project: projects, client: clients.name })
        .from(projects)
        .leftJoin(clients, eq(clients.id, projects.clientId))
        .where(p.projectId === null ? ne(projects.status, "closed") : eq(projects.id, p.projectId))
        .orderBy(asc(projects.code))
        .all();
      const booked = groupBy(loggedEntries(db, ctx, { projectId: p.projectId }), (e) => e.projectId);
      const rows = list.map(({ project, client }) => {
        const minutes = totals(booked.get(project.id) ?? []).logged;
        const budget = project.budgetHours === null ? null : project.budgetHours * 60;
        return {
          project: project.code, name: project.name, client: client ?? "Internal", status: PROJECT_STATUS_LABELS[project.status], budget, booked: minutes,
          burn: budget === null ? null : percent(minutes, budget), remaining: budget === null ? null : budget - minutes,
        };
      });
      return {
        columns: [
          { key: "project", label: "Project", type: "text" }, { key: "name", label: "Name", type: "text" }, { key: "client", label: "Client", type: "text" },
          { key: "status", label: "Status", type: "text" }, { key: "budget", label: "Budget", type: "minutes" }, { key: "booked", label: "Booked", type: "minutes" },
          { key: "burn", label: "Burn", type: "percent" }, { key: "remaining", label: "Remaining", type: "minutes" },
        ],
        rows,
        chart: { type: "bar", x: "project", series: [{ key: "burn", label: "Burn %" }] },
        note: `${ctx.scope === null ? "" : "Only hours booked by people in your team. "}Closed projects are shown when picked. ${LOGGED_NOTE}`,
      };
    },
  },
  {
    ...TIMESHEETS,
    slug: "missing-timesheets",
    title: "Missing timesheets",
    description: "People with working hours in a week whose timesheet isn't submitted.",
    filters: ["week", "department"],
    run: (db, ctx, p) => {
      const end = addDays(p.week, 6);
      const people = reportEmployees(db, ctx, { departmentId: p.departmentId, from: p.week, to: end });
      const loginIds = people.map((e) => e.userId).filter((id): id is number => id !== null);
      const active = new Set(loginIds.length ? db.select({ id: users.id }).from(users).where(and(inArray(users.id, loginIds), eq(users.status, "active"))).all().map((u) => u.id) : []);
      const weeks = new Map(
        people.length
          ? db.select().from(timesheets).where(and(eq(timesheets.weekStart, p.week), inArray(timesheets.employeeId, people.map((e) => e.id)))).all().map((t) => [t.employeeId, t])
          : [],
      );
      const managers = new Map(db.select({ id: employees.id, name: employees.displayName }).from(employees).all().map((e) => [e.id, e.name]));
      const rows = people
        .filter((e) => e.userId !== null && active.has(e.userId))
        .filter((e) => !["submitted", "approved"].includes(weeks.get(e.id)?.status ?? "draft"))
        .map((e) => ({ e, expected: availableMinutes(db, e.id, p.week, end), sheet: weeks.get(e.id) }))
        .filter(({ expected }) => expected > 0)
        .map(({ e, expected, sheet }) => {
          const logged = sheet ? db.select({ minutes: timesheetEntries.minutes }).from(timesheetEntries).where(eq(timesheetEntries.timesheetId, sheet.id)).all().reduce((s, r) => s + r.minutes, 0) : 0;
          return {
            code: e.employeeCode, name: e.displayName, department: e.department, manager: e.reportingManagerId ? (managers.get(e.reportingManagerId) ?? null) : null,
            status: sheet ? TIMESHEET_STATUS_LABELS[sheet.status] : "Not started", expected, logged,
          };
        });
      return {
        columns: [
          { key: "code", label: "Code", type: "text" }, { key: "name", label: "Name", type: "text" }, { key: "department", label: "Department", type: "text" },
          { key: "manager", label: "Reporting manager", type: "text" }, { key: "status", label: "Status", type: "text" },
          { key: "expected", label: "Available", type: "minutes" }, { key: "logged", label: "Logged so far", type: "minutes" },
        ],
        rows,
        note: `Week of ${weekRangeLabel(p.week)}. People without an active login or with no working hours that week are left out.`,
      };
    },
  },
];
