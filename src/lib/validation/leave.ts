import { z } from "zod";
import { EMPLOYMENT_TYPES } from "@/lib/hr";
import { HOLIDAY_TYPES, LEAVE_ACCRUALS, LEAVE_HALVES, halvesError, isHalfStep } from "@/lib/leave";
import { isoDate, optionalText } from "./employees";

const id = z.number().int().positive();
const halfSteps = (max: number) =>
  z.number().min(0).max(max, `At most ${max}`).refine(isHalfStep, "Use steps of 0.5 days");

const leaveTypeShape = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{0,9}$/, "1–10 letters, digits or _, starting with a letter"),
  name: z.string().trim().min(1, "Required").max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour"),
  paid: z.boolean(),
  isLop: z.boolean(),
  accrual: z.enum(LEAVE_ACCRUALS),
  annualQuota: halfSteps(365),
  carryForwardMax: halfSteps(365),
  encashable: z.boolean(),
  allowHalfDay: z.boolean(),
  allowNegative: z.boolean(),
  maxConsecutiveDays: z.number().int().min(1).max(365).nullable(),
  minNoticeDays: z.number().int().min(0).max(365),
  attachmentAfterDays: halfSteps(365).nullable(),
  countWeekends: z.boolean(),
  /** null = every employment type. */
  applicableEmploymentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).min(1, "Pick at least one, or allow all").nullable(),
};

function checkLeaveType(value: { isLop: boolean; paid: boolean }, ctx: z.RefinementCtx) {
  if (value.isLop && value.paid) ctx.addIssue({ code: "custom", path: ["paid"], message: "Loss-of-pay leave cannot be paid" });
}

export const leaveTypeSchema = z.object(leaveTypeShape).superRefine(checkLeaveType);
export const updateLeaveTypeSchema = z.object({ ...leaveTypeShape, id }).superRefine(checkLeaveType);
export type LeaveTypeInput = z.output<typeof leaveTypeSchema>;

const applyShape = {
  leaveTypeId: id,
  startDate: isoDate,
  endDate: isoDate,
  startHalf: z.enum(LEAVE_HALVES),
  endHalf: z.enum(LEAVE_HALVES),
  reason: optionalText(500),
};

function checkRange(
  value: { startDate: string; endDate: string; startHalf: (typeof LEAVE_HALVES)[number]; endHalf: (typeof LEAVE_HALVES)[number] },
  ctx: z.RefinementCtx,
) {
  if (value.endDate < value.startDate) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "Must be on or after the start date" });
    return;
  }
  const error = halvesError(value.startDate, value.endDate, value.startHalf, value.endHalf);
  if (error) ctx.addIssue({ code: "custom", path: ["startHalf"], message: error });
}

export const applyLeaveSchema = z.object(applyShape).superRefine(checkRange);
export type ApplyLeaveInput = z.output<typeof applyLeaveSchema>;

export const applyOnBehalfSchema = z.object({ ...applyShape, employeeId: id }).superRefine(checkRange);
export type ApplyOnBehalfInput = z.output<typeof applyOnBehalfSchema>;

export const quoteLeaveSchema = z.object({ ...applyShape, employeeId: id.nullable() }).superRefine(checkRange);

export const leaveDecisionSchema = z.object({
  requestId: id,
  decision: z.enum(["approved", "rejected"]),
  note: optionalText(300),
});

export const cancelLeaveSchema = z.object({ requestId: id, note: optionalText(300) });

export const bulkApproveSchema = z.object({
  requestIds: z.array(id).min(1, "Select at least one request").max(100),
  note: optionalText(300),
});

export const adjustmentSchema = z.object({
  employeeId: id,
  leaveTypeId: id,
  year: z.number().int().min(2000).max(2100),
  delta: z
    .number()
    .refine((v) => v !== 0, "Enter a non-zero number of days")
    .refine(isHalfStep, "Use steps of 0.5 days")
    .refine((v) => Math.abs(v) <= 365, "At most 365 days"),
  note: z.string().trim().min(3, "Explain the adjustment").max(300),
});
export type AdjustmentInput = z.output<typeof adjustmentSchema>;

export const holidaySchema = z.object({
  date: isoDate,
  name: z.string().trim().min(1, "Required").max(80),
  type: z.enum(HOLIDAY_TYPES),
});
export type HolidayInput = z.output<typeof holidaySchema>;

export const holidayYearConfigSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  optionalAllowed: z.number().int().min(0).max(50),
});

export const leaveSettingsFormSchema = z.object({
  yearStartMonth: z.number().int().min(1).max(12),
});
export type LeaveSettingsForm = z.output<typeof leaveSettingsFormSchema>;
