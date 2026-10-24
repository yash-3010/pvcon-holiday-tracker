import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { addMonths, formatPeriod, monthRange, type Period } from "@/lib/dates";
import { CLAIM_CATEGORY_LABELS, CLAIM_STATUS_LABELS, COMPONENT_KIND_LABELS, PAYSLIP_STATUS_LABELS, RUN_TYPE_LABELS, type RunStatus } from "@/lib/payroll/constants";
import type { DbLike } from "@/server/db/client";
import {
  employeeSalaries, expenseClaims, payrollRuns, payslipLines, payslips, salaryComponents, salaryStructures, users, type PayrollRunRow, type PayslipRow,
} from "@/server/db/schema";
import { bankAdvice } from "@/server/modules/payroll/exports";
import { listLoans, myYearStatement } from "@/server/modules/payroll/queries";
import { getSetting } from "@/server/modules/settings/service";
import { percent, reportEmployees } from "./common";
import type { ReportColumn, ReportDefinition, ReportRow } from "./types";

const PAYROLL = { area: "payroll", permissions: ["report.payroll"], orgWide: "report.payroll" } as const;
/** Runs past maker-checker: their figures no longer change. */
const POSTED: RunStatus[] = ["approved", "released", "paid"];
const POSTED_NOTE = "Counts approved, released and paid runs.";

/** The chosen run, or the latest one in `statuses`. */
function pickRun(db: DbLike, runId: number | null, statuses: RunStatus[]): PayrollRunRow | undefined {
  return db
    .select()
    .from(payrollRuns)
    .where(and(inArray(payrollRuns.status, statuses), runId === null ? undefined : eq(payrollRuns.id, runId)))
    .orderBy(desc(payrollRuns.period), desc(payrollRuns.id))
    .get();
}

const runLabel = (run: PayrollRunRow) => `${formatPeriod(run.period)} ${RUN_TYPE_LABELS[run.type].toLowerCase()} run`;

/** Included and held payslips of posted runs for months [from, to]. */
function postedPayslips(db: DbLike, from: Period, to: Period): { payslip: PayslipRow; period: Period }[] {
  return db
    .select({ payslip: payslips, period: payrollRuns.period })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
    .where(and(inArray(payrollRuns.status, POSTED), gte(payrollRuns.period, from), lte(payrollRuns.period, to), ne(payslips.status, "excluded")))
    .all();
}

const componentNames = (db: DbLike) => new Map(db.select({ code: salaryComponents.code, name: salaryComponents.name }).from(salaryComponents).all().map((c) => [c.code, c.name]));

const TOTAL_COLUMNS: ReportColumn[] = [
  { key: "gross", label: "Gross earnings", type: "money" }, { key: "deductions", label: "Deductions", type: "money" },
  { key: "employer", label: "Employer contributions", type: "money" }, { key: "reimbursements", label: "Reimbursements", type: "money" },
  { key: "net", label: "Net pay", type: "money" },
];
const totalsOf = (p: PayslipRow) => ({ gross: p.grossEarnings, deductions: p.totalDeductions, employer: p.employerContributions, reimbursements: p.reimbursements, net: p.netPay });

export const payrollReports: ReportDefinition[] = [
  {
    ...PAYROLL,
    slug: "payroll-register",
    title: "Payroll register",
    description: "Every payslip of a run with a column per component.",
    filters: ["run"],
    run: (db, _ctx, p) => {
      const run = pickRun(db, p.runId, ["computed", ...POSTED]);
      if (!run) return { columns: [], rows: [], note: "No computed payroll run yet." };
      const people = new Map(reportEmployees(db, { scope: null }).map((e) => [e.id, e]));
      const rows = db.select().from(payslips).where(eq(payslips.runId, run.id)).all();
      const lines = rows.length ? db.select().from(payslipLines).where(inArray(payslipLines.payslipId, rows.map((r) => r.id))).orderBy(asc(payslipLines.sortOrder)).all() : [];
      const names = componentNames(db);
      const codes = [...new Set(lines.map((l) => l.componentCode))];
      return {
        columns: [
          { key: "code", label: "Code", type: "text" }, { key: "name", label: "Name", type: "text" }, { key: "department", label: "Department", type: "text" },
          { key: "status", label: "Status", type: "text" }, { key: "paidDays", label: "Paid days", type: "days" }, { key: "lopDays", label: "LOP days", type: "days" },
          ...codes.map((code): ReportColumn => ({ key: `c:${code}`, label: names.get(code) ?? lines.find((l) => l.componentCode === code)!.componentName, type: "money" })),
          ...TOTAL_COLUMNS,
        ],
        rows: rows
          .map((s) => ({ s, e: people.get(s.employeeId)! }))
          .sort((a, b) => a.e.employeeCode.localeCompare(b.e.employeeCode))
          .map(({ s, e }) => {
            const amounts = new Map<string, number>();
            for (const l of lines) if (l.payslipId === s.id) amounts.set(l.componentCode, (amounts.get(l.componentCode) ?? 0) + l.amount);
            return {
              code: e.employeeCode, name: e.displayName, department: e.department, status: PAYSLIP_STATUS_LABELS[s.status], paidDays: s.paidDays, lopDays: s.lopDays,
              ...Object.fromEntries(codes.map((code) => [`c:${code}`, amounts.get(code) ?? 0])), ...totalsOf(s),
            };
          }),
        note: `${runLabel(run)} (${run.status}). Arrears and claims are added to their component's column.`,
      };
    },
  },
  {
    ...PAYROLL,
    slug: "component-summary",
    title: "Component summary",
    description: "Each component's total per month of a financial year.",
    filters: ["fiscalYear"],
    run: (db, _ctx, p) => {
      const { start, end } = p.fiscalYear;
      const months = Array.from({ length: 12 }, (_, i) => addMonths(start, i));
      const slips = postedPayslips(db, start, end);
      const periodOf = new Map(slips.map((s) => [s.payslip.id, s.period]));
      const lines = slips.length ? db.select().from(payslipLines).where(inArray(payslipLines.payslipId, [...periodOf.keys()])).orderBy(asc(payslipLines.sortOrder)).all() : [];
      const names = componentNames(db);
      const byCode = new Map<string, ReportRow & { total: number }>();
      for (const l of lines) {
        const row = byCode.get(l.componentCode) ?? {
          component: names.get(l.componentCode) ?? l.componentName, kind: COMPONENT_KIND_LABELS[l.kind], ...Object.fromEntries(months.map((m) => [m, 0])), total: 0,
        };
        const month = periodOf.get(l.payslipId)!;
        row[month] = (row[month] as number) + l.amount;
        row.total += l.amount;
        byCode.set(l.componentCode, row);
      }
      const order = Object.values(COMPONENT_KIND_LABELS);
      return {
        columns: [
          { key: "component", label: "Component", type: "text" }, { key: "kind", label: "Kind", type: "text" },
          ...months.map((m): ReportColumn => ({ key: m, label: formatPeriod(m), type: "money" })),
          { key: "total", label: "Total", type: "money" },
        ],
        rows: [...byCode.values()].sort((a, b) => order.indexOf(a.kind as string) - order.indexOf(b.kind as string)),
        note: `${p.fiscalYear.label}. ${POSTED_NOTE}`,
      };
    },
  },
  {
    ...PAYROLL,
    permissions: ["payroll.run"],
    orgWide: "payroll.run",
    slug: "bank-advice",
    title: "Bank advice",
    description: "The bank transfer list of a run, with full account numbers.",
    filters: ["run"],
    run: (db, _ctx, p) => {
      const run = pickRun(db, p.runId, POSTED);
      if (!run) return { columns: [], rows: [], note: "No approved payroll run yet." };
      const rows = bankAdvice(db, run.id);
      return {
        columns: [
          { key: "code", label: "Code", type: "text" }, { key: "name", label: "Name", type: "text" }, { key: "bankName", label: "Bank", type: "text" },
          { key: "account", label: "Account number", type: "text" }, { key: "ifsc", label: "IFSC", type: "text" }, { key: "amount", label: "Amount", type: "money" },
        ],
        rows: rows.map((r) => ({ ...r })),
        note: `${runLabel(run)}: ${rows.length} transfer(s). Held and excluded payslips aren't paid.`,
      };
    },
  },
  {
    ...PAYROLL,
    slug: "employer-cost",
    title: "Employer cost by department",
    description: "Gross pay, employer contributions and reimbursements per department in a month.",
    filters: ["period"],
    run: (db, _ctx, p) => {
      const people = new Map(reportEmployees(db, { scope: null }).map((e) => [e.id, e.department ?? "No department"]));
      const groups = new Map<string, PayslipRow[]>();
      for (const { payslip } of postedPayslips(db, p.period, p.period)) {
        const department = people.get(payslip.employeeId)!;
        groups.set(department, [...(groups.get(department) ?? []), payslip]);
      }
      const rows = [...groups.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([department, list]) => {
          const sum = (pick: (s: PayslipRow) => number) => list.reduce((s, x) => s + pick(x), 0);
          const gross = sum((s) => s.grossEarnings);
          const employer = sum((s) => s.employerContributions);
          const reimbursements = sum((s) => s.reimbursements);
          return { department, people: new Set(list.map((s) => s.employeeId)).size, gross, employer, reimbursements, cost: gross + employer + reimbursements };
        });
      const total = rows.reduce((s, r) => s + r.cost, 0);
      return {
        columns: [
          { key: "department", label: "Department", type: "text" }, { key: "people", label: "People", type: "number" }, { key: "gross", label: "Gross earnings", type: "money" },
          { key: "employer", label: "Employer contributions", type: "money" }, { key: "reimbursements", label: "Reimbursements", type: "money" },
          { key: "cost", label: "Total cost", type: "money" }, { key: "share", label: "Share", type: "percent" },
        ],
        rows: rows.map((r) => ({ ...r, share: percent(r.cost, total) })),
        chart: { type: "bar", x: "department", series: [{ key: "cost", label: "Total cost (paise)" }] },
        note: `${formatPeriod(p.period)}, regular and off-cycle runs, by each person's current department. ${POSTED_NOTE}`,
      };
    },
  },
  {
    ...PAYROLL,
    slug: "ytd-statement",
    title: "Year-to-date statement",
    description: "One employee's released pay per component and month of a financial year.",
    filters: ["employee", "fiscalYear"],
    required: ["employee"],
    run: (db, _ctx, p) => {
      if (p.employeeId === null) return { columns: [], rows: [], note: "Choose an employee." };
      const statement = myYearStatement(db, p.employeeId, p.fiscalYear.start, getSetting(db, "locale").fiscalYearStartMonth);
      const row = (component: string, kind: string, amounts: number[], total: number): ReportRow => ({
        component, kind, ...Object.fromEntries(statement.periods.map((m, i) => [m, amounts[i] ?? 0])), total,
      });
      const slips = statement.periods.length
        ? db
            .select({ payslip: payslips, period: payrollRuns.period })
            .from(payslips)
            .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
            .where(and(eq(payslips.employeeId, p.employeeId), gte(payrollRuns.period, p.fiscalYear.start), lte(payrollRuns.period, p.fiscalYear.end)))
            .all()
            .filter((s) => s.payslip.releasedAt !== null)
        : [];
      const monthly = (pick: (s: PayslipRow) => number) => statement.periods.map((m) => slips.filter((s) => s.period === m).reduce((t, s) => t + pick(s.payslip), 0));
      return {
        columns: [
          { key: "component", label: "Component", type: "text" }, { key: "kind", label: "Kind", type: "text" },
          ...statement.periods.map((m): ReportColumn => ({ key: m, label: formatPeriod(m), type: "money" })), { key: "total", label: "Total", type: "money" },
        ],
        rows: [
          ...statement.lines.map((l) => row(l.name, COMPONENT_KIND_LABELS[l.kind], l.amounts, l.total)),
          row("Gross earnings", "Total", monthly((s) => s.grossEarnings), statement.totals.grossEarnings),
          row("Total deductions", "Total", monthly((s) => s.totalDeductions), statement.totals.totalDeductions),
          row("Net pay", "Total", monthly((s) => s.netPay), statement.totals.netPay),
        ],
        note: `${statement.fiscalYear}, released payslips only.`,
      };
    },
  },
  {
    ...PAYROLL,
    slug: "loan-register",
    title: "Loan register",
    description: "Loans and salary advances with what is repaid and outstanding.",
    filters: ["department"],
    run: (db, ctx, p) => {
      const people = new Map(reportEmployees(db, ctx, { departmentId: p.departmentId }).map((e) => [e.id, e]));
      const rows = listLoans(db, {})
        .filter((l) => people.has(l.employeeId))
        .sort((a, b) => a.startPeriod.localeCompare(b.startPeriod) || a.id - b.id)
        .map((l) => ({
          code: l.employeeCode, name: l.employeeName, department: people.get(l.employeeId)!.department, type: l.type === "loan" ? "Loan" : "Advance",
          start: formatPeriod(l.startPeriod), principal: l.principal, emi: l.emi, repaid: l.repaid, outstanding: l.outstanding,
          status: { active: "Active", paused: "Paused", closed: "Closed" }[l.status], note: l.note,
        }));
      return {
        columns: [
          { key: "code", label: "Code", type: "text" }, { key: "name", label: "Name", type: "text" }, { key: "department", label: "Department", type: "text" },
          { key: "type", label: "Type", type: "text" }, { key: "start", label: "First EMI", type: "text" }, { key: "principal", label: "Principal", type: "money" },
          { key: "emi", label: "EMI", type: "money" }, { key: "repaid", label: "Repaid", type: "money" }, { key: "outstanding", label: "Outstanding", type: "money" },
          { key: "status", label: "Status", type: "text" }, { key: "note", label: "Note", type: "text" },
        ],
        rows,
      };
    },
  },
  {
    ...PAYROLL,
    slug: "claims-register",
    title: "Claims register",
    description: "Expense claims dated in a range, with their status and the run that paid them.",
    filters: ["range", "department"],
    run: (db, ctx, p) => {
      const people = new Map(reportEmployees(db, ctx, { departmentId: p.departmentId }).map((e) => [e.id, e]));
      const approvers = new Map(db.select({ id: users.id, name: users.name }).from(users).all().map((u) => [u.id, u.name]));
      const runs = new Map(db.select().from(payrollRuns).all().map((r) => [r.id, r]));
      const rows = people.size
        ? db
            .select()
            .from(expenseClaims)
            .where(and(inArray(expenseClaims.employeeId, [...people.keys()]), ne(expenseClaims.status, "draft"), gte(expenseClaims.claimDate, p.from), lte(expenseClaims.claimDate, p.to)))
            .orderBy(asc(expenseClaims.claimDate), asc(expenseClaims.id))
            .all()
        : [];
      return {
        columns: [
          { key: "date", label: "Date", type: "date" }, { key: "code", label: "Code", type: "text" }, { key: "name", label: "Name", type: "text" },
          { key: "category", label: "Category", type: "text" }, { key: "description", label: "Description", type: "text" }, { key: "amount", label: "Amount", type: "money" },
          { key: "status", label: "Status", type: "text" }, { key: "approvedBy", label: "Approved by", type: "text" }, { key: "paidIn", label: "Paid in", type: "text" },
        ],
        rows: rows.map((c) => {
          const e = people.get(c.employeeId)!;
          const run = c.paidRunId ? runs.get(c.paidRunId) : undefined;
          return {
            date: c.claimDate, code: e.employeeCode, name: e.displayName, category: CLAIM_CATEGORY_LABELS[c.category], description: c.description, amount: c.amount,
            status: CLAIM_STATUS_LABELS[c.status], approvedBy: c.approverId ? (approvers.get(c.approverId) ?? null) : null, paidIn: run ? runLabel(run) : null,
          };
        }),
        note: "Drafts are left out.",
      };
    },
  },
  {
    ...PAYROLL,
    slug: "salary-revisions",
    title: "Salary revision history",
    description: "Salary revisions effective in a date range, with the change from the one before.",
    filters: ["range", "department", "employee"],
    run: (db, ctx, p) => {
      const people = new Map(reportEmployees(db, ctx, { departmentId: p.departmentId, employeeId: p.employeeId }).map((e) => [e.id, e]));
      if (!people.size) return { columns: [], rows: [] };
      const recorders = new Map(db.select({ id: users.id, name: users.name }).from(users).all().map((u) => [u.id, u.name]));
      const history = db
        .select({ salary: employeeSalaries, structure: salaryStructures.name })
        .from(employeeSalaries)
        .innerJoin(salaryStructures, eq(salaryStructures.id, employeeSalaries.structureId))
        .where(and(inArray(employeeSalaries.employeeId, [...people.keys()]), lte(employeeSalaries.effectiveFrom, p.to)))
        .orderBy(asc(employeeSalaries.effectiveFrom), asc(employeeSalaries.id))
        .all();
      const rows = history
        .map(({ salary, structure }, i) => {
          // The revision before is the latest earlier row of the same person, for an earlier month.
          const before = history.slice(0, i).filter((h) => h.salary.employeeId === salary.employeeId && h.salary.effectiveFrom < salary.effectiveFrom).at(-1);
          const e = people.get(salary.employeeId)!;
          const previous = before?.salary.annualCtc ?? null;
          return {
            effective: salary.effectiveFrom, code: e.employeeCode, name: e.displayName, department: e.department, structure, ctc: salary.annualCtc, previous,
            change: previous ? Math.round(((salary.annualCtc - previous) / previous) * 1000) / 10 : null, reason: salary.reason,
            recorded: salary.createdAt.slice(0, 10), by: salary.createdBy ? (recorders.get(salary.createdBy) ?? null) : null,
          };
        })
        .filter((r) => r.effective >= monthRange(p.from.slice(0, 7)).start);
      return {
        columns: [
          { key: "effective", label: "Effective from", type: "date" }, { key: "code", label: "Code", type: "text" }, { key: "name", label: "Name", type: "text" },
          { key: "department", label: "Department", type: "text" }, { key: "structure", label: "Structure", type: "text" }, { key: "ctc", label: "Annual CTC", type: "money" },
          { key: "previous", label: "Previous CTC", type: "money" }, { key: "change", label: "Change", type: "percent" }, { key: "reason", label: "Reason", type: "text" },
          { key: "recorded", label: "Recorded", type: "date" }, { key: "by", label: "By", type: "text" },
        ],
        rows,
        note: "A correction of a month already paid shows as a second row for that month.",
      };
    },
  },
];
