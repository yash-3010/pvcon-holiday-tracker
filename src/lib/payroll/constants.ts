export const COMPONENT_KINDS = ["earning", "deduction", "employer_contribution", "reimbursement"] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];
export const COMPONENT_KIND_LABELS: Record<ComponentKind, string> = {
  earning: "Earning",
  deduction: "Deduction",
  employer_contribution: "Employer contribution",
  reimbursement: "Reimbursement",
};

export const COMPONENT_CALCS = ["fixed", "percent", "formula", "balance", "input"] as const;
export type ComponentCalc = (typeof COMPONENT_CALCS)[number];
export const COMPONENT_CALC_LABELS: Record<ComponentCalc, string> = {
  fixed: "Fixed amount",
  percent: "Percent of another component",
  formula: "Formula",
  balance: "Balance of the CTC",
  input: "Entered each run",
};

export const ROUND_MODES = ["none", "nearest", "up", "down"] as const;
export const ROUND_MODE_LABELS: Record<(typeof ROUND_MODES)[number], string> = {
  none: "To the paisa",
  nearest: "To the nearest rupee",
  up: "Up to the rupee",
  down: "Down to the rupee",
};

/** Components the system writes inputs to: approved expense claims and loan EMIs. They can't be archived or retyped. */
export const SYSTEM_COMPONENTS = { reimbursement: "REIMB", loan: "LOAN_EMI" } as const;

export const RUN_TYPES = ["regular", "off_cycle"] as const;
export type RunType = (typeof RUN_TYPES)[number];
export const RUN_TYPE_LABELS: Record<RunType, string> = { regular: "Regular", off_cycle: "Off-cycle" };

export const RUN_STATUSES = ["draft", "computed", "approved", "released", "paid", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  draft: "Draft",
  computed: "Computed",
  approved: "Approved",
  released: "Released",
  paid: "Paid",
  cancelled: "Cancelled",
};
export const RUN_STATUS_BADGE: Record<RunStatus, "secondary" | "info" | "warning" | "success" | "default"> = {
  draft: "secondary",
  computed: "info",
  approved: "warning",
  released: "success",
  paid: "default",
  cancelled: "secondary",
};
/** A period counts as closed for the next regular run once its run reaches one of these. */
export const CLOSED_RUN_STATUSES: readonly RunStatus[] = ["approved", "released", "paid"];

export const PAYSLIP_STATUSES = ["ok", "hold", "excluded"] as const;
export type PayslipStatus = (typeof PAYSLIP_STATUSES)[number];
export const PAYSLIP_STATUS_LABELS: Record<PayslipStatus, string> = { ok: "Included", hold: "On hold", excluded: "Excluded" };

export const INPUT_SOURCES = ["manual", "claim", "loan", "arrear", "encashment"] as const;
export type InputSource = (typeof INPUT_SOURCES)[number];

export const LOAN_TYPES = ["loan", "advance"] as const;
export type LoanType = (typeof LOAN_TYPES)[number];
export const LOAN_STATUSES = ["active", "paused", "closed"] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const CLAIM_STATUSES = ["draft", "submitted", "approved", "rejected", "paid"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  paid: "Paid",
};
export const CLAIM_CATEGORIES = ["travel", "meals", "internet", "equipment", "training", "other"] as const;
export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];
export const CLAIM_CATEGORY_LABELS: Record<ClaimCategory, string> = {
  travel: "Travel",
  meals: "Meals",
  internet: "Phone and internet",
  equipment: "Equipment",
  training: "Training",
  other: "Other",
};

/** Variables formulas can use (spec §5.6), besides `<CODE>` (earned) and `<CODE>_RATE` (full month) of components. */
export const VARIABLES = [
  "CTC", "MONTHLY_CTC", "TOTAL_DAYS", "WORKING_DAYS", "PAID_DAYS", "LOP_DAYS", "PRESENT_DAYS", "OT_HOURS",
  "OFF_DAY_WORKED_DAYS", "COMP_OFF_DAYS", "ENCASH_DAYS", "YEARS_OF_SERVICE", "MONTHS_OF_SERVICE",
] as const;
export type Variable = (typeof VARIABLES)[number];
export const VARIABLE_HELP: Record<Variable, string> = {
  CTC: "Annual cost to company",
  MONTHLY_CTC: "CTC ÷ 12",
  TOTAL_DAYS: "Days in the pay period (calendar or working, per settings)",
  WORKING_DAYS: "Working days in the period",
  PAID_DAYS: "Total days less loss-of-pay days",
  LOP_DAYS: "Loss-of-pay days",
  PRESENT_DAYS: "Days present (half days count ½)",
  OT_HOURS: "Overtime hours",
  OFF_DAY_WORKED_DAYS: "Weekly offs and holidays worked",
  COMP_OFF_DAYS: "Comp-off days approved for payout and not yet paid",
  ENCASH_DAYS: "Encashable leave on the last working day, when leaving this period",
  YEARS_OF_SERVICE: "Completed years since joining",
  MONTHS_OF_SERVICE: "Completed months since joining",
};
