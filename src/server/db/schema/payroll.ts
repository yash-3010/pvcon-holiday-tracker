import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  CLAIM_CATEGORIES, CLAIM_STATUSES, COMPONENT_CALCS, COMPONENT_KINDS, INPUT_SOURCES, LOAN_STATUSES, LOAN_TYPES, PAYSLIP_STATUSES,
  ROUND_MODES, RUN_STATUSES, RUN_TYPES,
} from "../../../lib/payroll/constants";
import { nowIso, timestamps } from "../columns";
import { users } from "./auth";
import { employees } from "./core";
import { files } from "./system";

/** Amounts are integer paise. Percents are basis points (40% = 4000). */
export const salaryComponents = sqliteTable("salary_components", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind", { enum: COMPONENT_KINDS }).notNull(),
  calc: text("calc", { enum: COMPONENT_CALCS }).notNull(),
  defaultValue: integer("default_value"),
  percentOf: text("percent_of"),
  percent: integer("percent"),
  formula: text("formula"),
  prorate: integer("prorate", { mode: "boolean" }).notNull().default(true),
  /** Part of the CTC: earnings and employer contributions marked so are what the `balance` component completes. */
  inCtc: integer("in_ctc", { mode: "boolean" }).notNull().default(true),
  round: text("round", { enum: ROUND_MODES }).notNull().default("nearest"),
  showOnPayslip: integer("show_on_payslip", { mode: "boolean" }).notNull().default(true),
  taxableLabel: text("taxable_label"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** REIMB and LOAN_EMI receive system inputs; they can't be archived or retyped. */
  system: integer("system", { mode: "boolean" }).notNull().default(false),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

export const salaryStructures = sqliteTable("salary_structures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

/** A structure's ordered components; non-null fields replace the component's own value, percent or formula. */
export const salaryStructureComponents = sqliteTable(
  "salary_structure_components",
  {
    structureId: integer("structure_id")
      .notNull()
      .references(() => salaryStructures.id, { onDelete: "cascade" }),
    componentId: integer("component_id")
      .notNull()
      .references(() => salaryComponents.id),
    value: integer("value"),
    percent: integer("percent"),
    formula: text("formula"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.structureId, t.componentId] })],
);

/** Salary history. The salary for a month is the latest row effective on or before its 1st. */
export const employeeSalaries = sqliteTable(
  "employee_salaries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    /** Always the 1st of a month. */
    effectiveFrom: text("effective_from").notNull(),
    annualCtc: integer("annual_ctc").notNull(),
    structureId: integer("structure_id")
      .notNull()
      .references(() => salaryStructures.id),
    /** Component code → monthly amount in paise, or a formula. */
    overrides: text("overrides", { mode: "json" }).$type<Record<string, number | string>>().notNull(),
    reason: text("reason"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [uniqueIndex("employee_salaries_effective_idx").on(t.employeeId, t.effectiveFrom)],
);

export const payrollRuns = sqliteTable(
  "payroll_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    period: text("period").notNull(),
    type: text("type", { enum: RUN_TYPES }).notNull().default("regular"),
    status: text("status", { enum: RUN_STATUSES }).notNull().default("draft"),
    notes: text("notes"),
    /** Run-level problems from the last compute, e.g. employees without a salary. */
    warnings: text("warnings", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    computedBy: integer("computed_by").references(() => users.id, { onDelete: "set null" }),
    computedAt: text("computed_at"),
    approvedBy: integer("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: text("approved_at"),
    releasedAt: text("released_at"),
    paidAt: text("paid_at"),
    paidOn: text("paid_on"),
    paymentRef: text("payment_ref"),
    ...timestamps(),
  },
  (t) => [
    // One live regular run per period; cancelled runs don't count.
    uniqueIndex("payroll_runs_regular_period_idx")
      .on(t.period)
      .where(sql`${t.type} = 'regular' and ${t.status} != 'cancelled'`),
  ],
);

export const payrollInputs = sqliteTable(
  "payroll_inputs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    componentId: integer("component_id")
      .notNull()
      .references(() => salaryComponents.id),
    amount: integer("amount").notNull(),
    /** What the payslip line says, e.g. "Arrears – Basic (Sep 2026)". */
    label: text("label").notNull(),
    note: text("note"),
    source: text("source", { enum: INPUT_SOURCES }).notNull().default("manual"),
    sourceId: integer("source_id"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("payroll_inputs_run_idx").on(t.runId, t.employeeId)],
);

export interface PayslipSnapshot {
  name: string;
  code: string;
  designation: string | null;
  department: string | null;
  dateOfJoining: string;
  bankName: string | null;
  bankAccountMasked: string | null;
  bankIfsc: string | null;
  pan: string | null;
  annualCtc: number;
  structure: string;
}

export const payslips = sqliteTable(
  "payslips",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    status: text("status", { enum: PAYSLIP_STATUSES }).notNull().default("ok"),
    /** The salary revision this payslip was computed with, and the one arrears have since brought it up to. */
    salaryId: integer("salary_id").references(() => employeeSalaries.id, { onDelete: "set null" }),
    paidBasisSalaryId: integer("paid_basis_salary_id").references(() => employeeSalaries.id, { onDelete: "set null" }),
    snapshot: text("snapshot", { mode: "json" }).$type<PayslipSnapshot>().notNull(),
    /** The formula variables used (days summary etc.), kept so arrears can be recomputed without attendance. */
    variables: text("variables", { mode: "json" }).$type<Record<string, number>>().notNull(),
    totalDays: real("total_days").notNull().default(0),
    workingDays: real("working_days").notNull().default(0),
    paidDays: real("paid_days").notNull().default(0),
    lopDays: real("lop_days").notNull().default(0),
    grossEarnings: integer("gross_earnings").notNull().default(0),
    totalDeductions: integer("total_deductions").notNull().default(0),
    employerContributions: integer("employer_contributions").notNull().default(0),
    reimbursements: integer("reimbursements").notNull().default(0),
    netPay: integer("net_pay").notNull().default(0),
    warnings: text("warnings", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    /** A calculation error; such a payslip is excluded until fixed. */
    error: text("error"),
    releasedAt: text("released_at"),
    emailedAt: text("emailed_at"),
    pdfFileId: integer("pdf_file_id").references(() => files.id),
    pdfSha256: text("pdf_sha256"),
    verificationCode: text("verification_code").unique(),
    signed: integer("signed", { mode: "boolean" }).notNull().default(false),
    ...timestamps(),
  },
  (t) => [uniqueIndex("payslips_run_employee_idx").on(t.runId, t.employeeId), index("payslips_employee_idx").on(t.employeeId)],
);

export const payslipLines = sqliteTable(
  "payslip_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    payslipId: integer("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    componentCode: text("component_code").notNull(),
    componentName: text("component_name").notNull(),
    kind: text("kind", { enum: COMPONENT_KINDS }).notNull(),
    amount: integer("amount").notNull(),
    /** The full-month amount before proration; null for input lines. */
    rateAmount: integer("rate_amount"),
    explanation: text("explanation"),
    /** "component", or the input source of an extra line. */
    source: text("source").notNull().default("component"),
    showOnPayslip: integer("show_on_payslip", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("payslip_lines_payslip_idx").on(t.payslipId)],
);

export const payslipVerifications = sqliteTable(
  "payslip_verifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    payslipId: integer("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    amountChecked: integer("amount_checked", { mode: "boolean" }).notNull().default(false),
    matched: integer("matched", { mode: "boolean" }),
    at: text("at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("payslip_verifications_payslip_idx").on(t.payslipId)],
);

export const loans = sqliteTable(
  "loans",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    type: text("type", { enum: LOAN_TYPES }).notNull().default("loan"),
    principal: integer("principal").notNull(),
    emi: integer("emi").notNull(),
    startPeriod: text("start_period").notNull(),
    status: text("status", { enum: LOAN_STATUSES }).notNull().default("active"),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index("loans_employee_idx").on(t.employeeId, t.status)],
);

export const loanRepayments = sqliteTable(
  "loan_repayments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    loanId: integer("loan_id")
      .notNull()
      .references(() => loans.id, { onDelete: "cascade" }),
    runId: integer("run_id")
      .notNull()
      .references(() => payrollRuns.id, { onDelete: "cascade" }),
    payslipId: integer("payslip_id").references(() => payslips.id, { onDelete: "set null" }),
    period: text("period").notNull(),
    amount: integer("amount").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("loan_repayments_loan_idx").on(t.loanId)],
);

export const expenseClaims = sqliteTable(
  "expense_claims",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    category: text("category", { enum: CLAIM_CATEGORIES }).notNull(),
    claimDate: text("claim_date").notNull(),
    amount: integer("amount").notNull(),
    description: text("description").notNull(),
    receiptFileId: integer("receipt_file_id").references(() => files.id),
    status: text("status", { enum: CLAIM_STATUSES }).notNull().default("draft"),
    submittedAt: text("submitted_at"),
    approverId: integer("approver_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: text("approved_at"),
    decisionNote: text("decision_note"),
    financeBy: integer("finance_by").references(() => users.id, { onDelete: "set null" }),
    paidRunId: integer("paid_run_id").references(() => payrollRuns.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [index("expense_claims_employee_idx").on(t.employeeId, t.status), index("expense_claims_status_idx").on(t.status)],
);

export type SalaryComponentRow = typeof salaryComponents.$inferSelect;
export type SalaryStructureRow = typeof salaryStructures.$inferSelect;
export type SalaryStructureComponentRow = typeof salaryStructureComponents.$inferSelect;
export type EmployeeSalaryRow = typeof employeeSalaries.$inferSelect;
export type PayrollRunRow = typeof payrollRuns.$inferSelect;
export type PayrollInputRow = typeof payrollInputs.$inferSelect;
export type PayslipRow = typeof payslips.$inferSelect;
export type PayslipLineRow = typeof payslipLines.$inferSelect;
export type PayslipVerificationRow = typeof payslipVerifications.$inferSelect;
export type LoanRow = typeof loans.$inferSelect;
export type LoanRepaymentRow = typeof loanRepayments.$inferSelect;
export type ExpenseClaimRow = typeof expenseClaims.$inferSelect;
