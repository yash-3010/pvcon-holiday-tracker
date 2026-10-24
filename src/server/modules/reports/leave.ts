import { and, asc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { COMP_OFF_LOT_STATUS_LABELS } from "@/lib/attendance";
import { diffDays } from "@/lib/dates";
import { LEAVE_STATUS_LABELS, leaveYearRange } from "@/lib/leave";
import type { DbLike } from "@/server/db/client";
import { compOffLots, leaveLedger, leaveRequests, leaveTypes, users } from "@/server/db/schema";
import { leaveYearStartMonth } from "@/server/modules/leave/ledger";
import { listLeaveTypes } from "@/server/modules/leave/types";
import { percent, reportEmployees } from "./common";
import type { ReportColumn, ReportDefinition } from "./types";

const LEAVE = { area: "leave", permissions: ["report.leave"], orgWide: "leave.view.all" } as const;

const USED = sql<number>`-sum(case when ${inArray(leaveLedger.kind, ["taken", "cancelled"])} then ${leaveLedger.delta} else 0 end)`;
const CREDITED = sql<number>`sum(case when ${leaveLedger.delta} > 0 and ${ne(leaveLedger.kind, "cancelled")} then ${leaveLedger.delta} else 0 end)`;

/** Ledger sums per employee and type for a leave year: the balance, days used net of cancellations, and credits. */
function ledgerSums(db: DbLike, employeeIds: number[], year: number) {
  if (!employeeIds.length) return [];
  return db
    .select({ employeeId: leaveLedger.employeeId, leaveTypeId: leaveLedger.leaveTypeId, balance: sql<number>`sum(${leaveLedger.delta})`, used: USED, credited: CREDITED })
    .from(leaveLedger)
    .where(and(eq(leaveLedger.year, year), inArray(leaveLedger.employeeId, employeeIds)))
    .groupBy(leaveLedger.employeeId, leaveLedger.leaveTypeId)
    .all();
}

export const leaveReports: ReportDefinition[] = [
  {
    ...LEAVE,
    slug: "leave-balances",
    title: "Leave balances",
    description: "Each person's balance and days used per leave type in a leave year.",
    filters: ["year", "department"],
    run: (db, ctx, p) => {
      const range = leaveYearRange(p.year, leaveYearStartMonth(db));
      const people = reportEmployees(db, ctx, { departmentId: p.departmentId, from: range.start, to: range.end });
      const types = listLeaveTypes(db).filter((t) => !t.isCompOff);
      const sums = ledgerSums(db, people.map((e) => e.id), p.year);
      const sum = (employeeId: number, typeId: number) => sums.find((s) => s.employeeId === employeeId && s.leaveTypeId === typeId);
      return {
        columns: [
          { key: "code", label: "Code", type: "text" }, { key: "name", label: "Name", type: "text" }, { key: "department", label: "Department", type: "text" },
          ...types.flatMap((t): ReportColumn[] => [
            ...(t.isLop ? [] : [{ key: `${t.code}:balance`, label: `${t.code} balance`, type: "days" as const }]),
            { key: `${t.code}:used`, label: `${t.code} used`, type: "days" },
          ]),
        ],
        rows: people.map((e) => ({
          code: e.employeeCode, name: e.displayName, department: e.department,
          ...Object.fromEntries(
            types.flatMap((t) => [
              ...(t.isLop ? [] : [[`${t.code}:balance`, sum(e.id, t.id)?.balance ?? 0]]),
              [`${t.code}:used`, sum(e.id, t.id)?.used || 0],
            ]),
          ),
        })),
        note: "Comp-off is in the comp-off lots report.",
      };
    },
  },
  {
    ...LEAVE,
    slug: "leave-register",
    title: "Leave register",
    description: "Every leave request that touches a date range, with its status and approver.",
    filters: ["range", "department", "employee"],
    run: (db, ctx, p) => {
      const people = reportEmployees(db, ctx, { departmentId: p.departmentId, employeeId: p.employeeId });
      const byId = new Map(people.map((e) => [e.id, e]));
      const requests = people.length
        ? db
            .select({ request: leaveRequests, type: leaveTypes.code, approver: users.name })
            .from(leaveRequests)
            .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
            .leftJoin(users, eq(users.id, leaveRequests.approverId))
            .where(
              and(
                inArray(leaveRequests.employeeId, [...byId.keys()]),
                ne(leaveRequests.status, "withdrawn"),
                lte(leaveRequests.startDate, p.to),
                gte(leaveRequests.endDate, p.from),
              ),
            )
            .orderBy(asc(leaveRequests.startDate), asc(leaveRequests.id))
            .all()
        : [];
      return {
        columns: [
          { key: "code", label: "Code", type: "text" }, { key: "name", label: "Name", type: "text" }, { key: "department", label: "Department", type: "text" },
          { key: "type", label: "Type", type: "text" }, { key: "from", label: "From", type: "date" }, { key: "to", label: "To", type: "date" },
          { key: "days", label: "Days", type: "days" }, { key: "status", label: "Status", type: "text" }, { key: "applied", label: "Applied", type: "date" },
          { key: "decidedBy", label: "Decided by", type: "text" }, { key: "reason", label: "Reason", type: "text" },
        ],
        rows: requests.map(({ request: r, type, approver }) => {
          const e = byId.get(r.employeeId)!;
          return {
            code: e.employeeCode, name: e.displayName, department: e.department, type, from: r.startDate, to: r.endDate, days: r.days,
            status: LEAVE_STATUS_LABELS[r.status], applied: r.createdAt.slice(0, 10), decidedBy: approver, reason: r.reason,
          };
        }),
        note: "Days are each request's whole length, also for requests that run past the range.",
      };
    },
  },
  {
    ...LEAVE,
    slug: "leave-utilization",
    title: "Leave utilization by type",
    description: "Days credited and used per leave type in a leave year, and the share used.",
    filters: ["year", "department"],
    run: (db, ctx, p) => {
      const range = leaveYearRange(p.year, leaveYearStartMonth(db));
      const people = reportEmployees(db, ctx, { departmentId: p.departmentId, from: range.start, to: range.end });
      const sums = ledgerSums(db, people.map((e) => e.id), p.year);
      const withEntries = new Set(sums.map((s) => s.leaveTypeId));
      const rows = listLeaveTypes(db, { includeArchived: true })
        .filter((t) => !t.archived || withEntries.has(t.id))
        .map((t) => {
          const mine = sums.filter((s) => s.leaveTypeId === t.id);
          const credited = mine.reduce((s, r) => s + r.credited, 0);
          const used = mine.reduce((s, r) => s + (r.used || 0), 0);
          return {
            type: `${t.code} · ${t.name}`, code: t.code, people: mine.filter((r) => r.used > 0).length, credited, used,
            balance: mine.reduce((s, r) => s + r.balance, 0), utilization: t.isLop ? null : percent(used, credited),
          };
        });
      return {
        columns: [
          { key: "type", label: "Leave type", type: "text" }, { key: "people", label: "People who took it", type: "number" },
          { key: "credited", label: "Credited", type: "days" }, { key: "used", label: "Used", type: "days" }, { key: "balance", label: "Balance", type: "days" },
          { key: "utilization", label: "Used of credited", type: "percent" },
        ],
        rows,
        chart: { type: "bar", x: "code", series: [{ key: "credited", label: "Credited" }, { key: "used", label: "Used" }] },
        note: "Credited counts openings, carry-forwards, grants, accruals, comp-off credits and positive adjustments.",
      };
    },
  },
  {
    ...LEAVE,
    slug: "comp-off-lots",
    title: "Comp-off lots and expiries",
    description: "Comp-off earned in a date range or still open, with what is left and when it expires.",
    filters: ["range", "department"],
    run: (db, ctx, p) => {
      const people = reportEmployees(db, ctx, { departmentId: p.departmentId });
      const byId = new Map(people.map((e) => [e.id, e]));
      const lots = people.length
        ? db
            .select()
            .from(compOffLots)
            .where(
              and(
                inArray(compOffLots.employeeId, [...byId.keys()]),
                or(eq(compOffLots.status, "active"), and(gte(compOffLots.earnedOn, p.from), lte(compOffLots.earnedOn, p.to)), and(gte(compOffLots.expiresOn, p.from), lte(compOffLots.expiresOn, p.to))),
              ),
            )
            .orderBy(asc(compOffLots.expiresOn), asc(compOffLots.id))
            .all()
        : [];
      return {
        columns: [
          { key: "code", label: "Code", type: "text" }, { key: "name", label: "Name", type: "text" }, { key: "earned", label: "Earned", type: "date" },
          { key: "source", label: "Source", type: "text" }, { key: "days", label: "Days", type: "days" }, { key: "remaining", label: "Remaining", type: "days" },
          { key: "expires", label: "Expires", type: "date" }, { key: "daysLeft", label: "Days to expiry", type: "number" }, { key: "status", label: "Status", type: "text" },
        ],
        rows: lots.map((l) => {
          const e = byId.get(l.employeeId)!;
          return {
            code: e.employeeCode, name: e.displayName, earned: l.earnedOn, source: l.claimId ? "Claim" : "Granted by HR", days: l.days, remaining: l.remaining,
            expires: l.expiresOn, daysLeft: l.status === "active" ? Math.max(0, diffDays(ctx.today, l.expiresOn)) : null, status: COMP_OFF_LOT_STATUS_LABELS[l.status],
          };
        }),
        note: "Lots earned or expiring in the range, and every lot still open; soonest expiry first.",
      };
    },
  },
];
