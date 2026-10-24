import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { ATTENDANCE_CODES, ATTENDANCE_STATUS_LABELS, WORK_MODE_LABELS } from "@/lib/attendance";
import { pushTo } from "@/lib/collections";
import { eachDay, formatHm, monthRange, type ISODate } from "@/lib/dates";
import type { DbLike } from "@/server/db/client";
import { attendanceDays, attendancePunches, compOffClaims, type AttendanceDayRow } from "@/server/db/schema";
import { isProvisional } from "@/server/modules/attendance/queries";
import { percent, reportEmployees, type ReportEmployee } from "./common";
import type { ReportContext, ReportDefinition, ReportParams } from "./types";

const ATTENDANCE = { area: "attendance", permissions: ["report.attendance"], orgWide: "attendance.view.all" } as const;

/** Closed attendance days (today's provisional status left out) of the report's people in [from, to]. */
function daysOf(db: DbLike, ctx: ReportContext, p: ReportParams, from: ISODate, to: ISODate): { people: ReportEmployee[]; days: Map<number, AttendanceDayRow[]> } {
  const people = reportEmployees(db, ctx, { departmentId: p.departmentId, from, to });
  const days = new Map<number, AttendanceDayRow[]>();
  if (!people.length) return { people, days };
  const rows = db
    .select()
    .from(attendanceDays)
    .where(and(inArray(attendanceDays.employeeId, people.map((e) => e.id)), gte(attendanceDays.date, from), lte(attendanceDays.date, to)))
    .orderBy(asc(attendanceDays.date))
    .all()
    .filter((r) => !isProvisional(r.date, ctx.today, r.status));
  for (const r of rows) pushTo(days, r.employeeId, r);
  return { people, days };
}

const CLAIM_LABELS = { pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn" } as const;

const who = (e: ReportEmployee) => ({ code: e.employeeCode, name: e.displayName, department: e.department });
const WHO_COLUMNS = [
  { key: "code", label: "Code", type: "text" }, { key: "name", label: "Name", type: "text" }, { key: "department", label: "Department", type: "text" },
] as const;

export const attendanceReports: ReportDefinition[] = [
  {
    ...ATTENDANCE,
    // Payroll admins check the month's attendance before a run.
    permissions: ["report.attendance", "report.payroll"],
    slug: "muster-roll",
    title: "Muster roll",
    description: "Each person's status code for every day of a month, with totals.",
    filters: ["period", "department"],
    run: (db, ctx, p) => {
      const { start, end } = monthRange(p.period);
      const { people, days } = daysOf(db, ctx, p, start, end);
      const dates = eachDay(start, end);
      return {
        columns: [
          { key: "code", label: "Code", type: "text" }, { key: "name", label: "Name", type: "text" },
          ...dates.map((d) => ({ key: d, label: d.slice(8), type: "text" as const })),
          { key: "present", label: "Present", type: "days" }, { key: "absent", label: "Absent", type: "days" }, { key: "leave", label: "Leave", type: "days" },
        ],
        rows: people.map((e) => {
          const mine = new Map((days.get(e.id) ?? []).map((d) => [d.date, d]));
          const count = (statuses: string[], halves: string[] = []) =>
            [...mine.values()].reduce((s, d) => s + (statuses.includes(d.status) ? 1 : halves.includes(d.status) ? 0.5 : 0), 0);
          return {
            code: e.employeeCode, name: e.displayName,
            ...Object.fromEntries(dates.map((d) => [d, mine.get(d) ? ATTENDANCE_CODES[mine.get(d)!.status] : null])),
            present: count(["present"], ["half_day", "half_leave"]), absent: count(["absent"], ["half_day"]), leave: count(["on_leave"], ["half_leave"]),
          };
        }),
        note: Object.entries(ATTENDANCE_CODES).map(([status, code]) => `${code} ${ATTENDANCE_STATUS_LABELS[status as keyof typeof ATTENDANCE_CODES]}`).join(" · "),
      };
    },
  },
  {
    ...ATTENDANCE,
    slug: "daily-status",
    title: "Daily status",
    description: "Everyone's status, times and work mode on one day.",
    filters: ["date", "department"],
    run: (db, ctx, p) => {
      const { people, days } = daysOf(db, ctx, p, p.date, p.date);
      const modes = firstInModes(db, people.map((e) => e.id), p.date, p.date);
      return {
        columns: [
          ...WHO_COLUMNS, { key: "status", label: "Status", type: "text" }, { key: "in", label: "In", type: "text" }, { key: "out", label: "Out", type: "text" },
          { key: "worked", label: "Worked", type: "minutes" }, { key: "late", label: "Late", type: "minutes" }, { key: "mode", label: "Mode", type: "text" },
        ],
        rows: people.map((e) => {
          const d = days.get(e.id)?.[0];
          const mode = modes.get(`${e.id}:${p.date}`);
          return {
            ...who(e), status: d ? ATTENDANCE_STATUS_LABELS[d.status] : null, in: d?.firstIn != null ? formatHm(d.firstIn) : null,
            out: d?.lastOut != null ? formatHm(d.lastOut) : null, worked: d?.workedMinutes ?? null, late: d?.lateMinutes ?? null,
            mode: mode ? WORK_MODE_LABELS[mode] : null,
          };
        }),
        note: p.date === ctx.today ? "Today's punch-based status is still changing and isn't shown." : undefined,
      };
    },
  },
  {
    ...ATTENDANCE,
    slug: "late-early",
    title: "Late arrivals and early exits",
    description: "Days late and leaving early, and the minutes, per person.",
    filters: ["range", "department"],
    run: (db, ctx, p) => {
      const { people, days } = daysOf(db, ctx, p, p.from, p.to);
      return {
        columns: [
          ...WHO_COLUMNS, { key: "lateDays", label: "Days late", type: "number" }, { key: "lateMinutes", label: "Late", type: "minutes" },
          { key: "earlyDays", label: "Days left early", type: "number" }, { key: "earlyMinutes", label: "Early", type: "minutes" },
        ],
        rows: people.map((e) => {
          const mine = days.get(e.id) ?? [];
          return {
            ...who(e), lateDays: mine.filter((d) => d.lateMinutes > 0).length, lateMinutes: mine.reduce((s, d) => s + d.lateMinutes, 0),
            earlyDays: mine.filter((d) => d.earlyMinutes > 0).length, earlyMinutes: mine.reduce((s, d) => s + d.earlyMinutes, 0),
          };
        }),
      };
    },
  },
  {
    ...ATTENDANCE,
    slug: "overtime",
    title: "Overtime",
    description: "Overtime beyond the shift, per person.",
    filters: ["range", "department"],
    run: (db, ctx, p) => {
      const { people, days } = daysOf(db, ctx, p, p.from, p.to);
      const rows = people.map((e) => {
        const mine = (days.get(e.id) ?? []).filter((d) => d.overtimeMinutes > 0);
        return { ...who(e), days: mine.length, overtime: mine.reduce((s, d) => s + d.overtimeMinutes, 0) };
      });
      return {
        columns: [...WHO_COLUMNS, { key: "days", label: "Days with overtime", type: "number" }, { key: "overtime", label: "Overtime", type: "minutes" }],
        rows,
        chart: { type: "bar", x: "name", series: [{ key: "overtime", label: "Overtime (minutes)" }] },
      };
    },
  },
  {
    ...ATTENDANCE,
    slug: "remote-office",
    title: "Remote and office days",
    description: "Days worked from the office and remotely, by the first clock-in of the day.",
    filters: ["range", "department"],
    run: (db, ctx, p) => {
      const people = reportEmployees(db, ctx, { departmentId: p.departmentId, from: p.from, to: p.to });
      const modes = firstInModes(db, people.map((e) => e.id), p.from, p.to);
      const rows = people.map((e) => {
        const mine = [...modes.entries()].filter(([key]) => key.startsWith(`${e.id}:`)).map(([, mode]) => mode);
        const office = mine.filter((m) => m === "office").length;
        const remote = mine.filter((m) => m === "remote").length;
        return { ...who(e), office, remote, remoteShare: percent(remote, office + remote) };
      });
      return {
        columns: [
          ...WHO_COLUMNS, { key: "office", label: "Office days", type: "number" }, { key: "remote", label: "Remote days", type: "number" },
          { key: "remoteShare", label: "Remote", type: "percent" },
        ],
        rows,
        chart: { type: "bar", x: "name", series: [{ key: "office", label: "Office" }, { key: "remote", label: "Remote" }] },
      };
    },
  },
  {
    ...ATTENDANCE,
    slug: "off-day-work",
    title: "Work on off days",
    description: "Weekly offs and holidays worked, with any comp-off claim.",
    filters: ["range", "department"],
    run: (db, ctx, p) => {
      const { people, days } = daysOf(db, ctx, p, p.from, p.to);
      const byId = new Map(people.map((e) => [e.id, e]));
      const worked = [...days.values()].flat().filter((d) => d.offDayWorked);
      const claims = worked.length
        ? db.select().from(compOffClaims).where(and(inArray(compOffClaims.employeeId, [...new Set(worked.map((d) => d.employeeId))]), gte(compOffClaims.workedDate, p.from), lte(compOffClaims.workedDate, p.to))).all()
        : [];
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, ...WHO_COLUMNS, { key: "worked", label: "Worked", type: "minutes" },
          { key: "claim", label: "Comp-off claim", type: "text" },
        ],
        rows: worked
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((d) => {
            const claim = claims.filter((c) => c.employeeId === d.employeeId && c.workedDate === d.date).at(-1);
            return {
              date: d.date, ...who(byId.get(d.employeeId)!), worked: d.workedMinutes,
              claim: claim ? `${CLAIM_LABELS[claim.status]}${claim.resolution ? ` (${claim.resolution === "payout" ? "paid out" : "comp-off leave"})` : ""}` : null,
            };
          }),
      };
    },
  },
];

/** The work mode of each day's first clock-in, keyed `employeeId:date`. */
function firstInModes(db: DbLike, employeeIds: number[], from: ISODate, to: ISODate): Map<string, "office" | "remote"> {
  const modes = new Map<string, "office" | "remote">();
  if (!employeeIds.length) return modes;
  const punches = db
    .select({ employeeId: attendancePunches.employeeId, date: attendancePunches.date, mode: attendancePunches.workMode })
    .from(attendancePunches)
    .where(and(inArray(attendancePunches.employeeId, employeeIds), eq(attendancePunches.direction, "in"), gte(attendancePunches.date, from), lte(attendancePunches.date, to)))
    .orderBy(asc(attendancePunches.at))
    .all();
  for (const p of punches) if (!modes.has(`${p.employeeId}:${p.date}`)) modes.set(`${p.employeeId}:${p.date}`, p.mode);
  return modes;
}
