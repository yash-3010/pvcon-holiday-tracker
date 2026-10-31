import { z } from "zod";
import { isISODate } from "@/lib/dates";
import { DAY_MINUTES, isQuarterHour, isWeekStart, PROJECT_STATUSES, weekDates } from "@/lib/timesheets";
import { optionalDate, optionalText } from "./employees";

const id = z.number().int().positive();

const code = (min: number, max: number, pattern: RegExp, message: string) =>
  optionalText(max)
    .refine((v) => v === null || (v.length >= min && pattern.test(v)), message)
    .transform((v) => v?.toUpperCase() ?? null);

export const clientSchema = z.object({
  name: z.string().trim().min(1, "Required").max(100),
  code: code(2, 10, /^[A-Za-z0-9]+$/, "2–10 letters or digits"),
});
export type ClientInput = z.output<typeof clientSchema>;

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Required").max(60),
  billableDefault: z.boolean(),
});
export type CategoryInput = z.output<typeof categorySchema>;

const projectShape = {
  name: z.string().trim().min(1, "Required").max(120),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{2,12}$/, "2–12 letters, digits or dashes")
    .transform((v) => v.toUpperCase()),
  /** null = an internal project, open to everyone. */
  clientId: id.nullable(),
  billableDefault: z.boolean(),
  status: z.enum(PROJECT_STATUSES),
  startDate: optionalDate,
  endDate: optionalDate,
  budgetHours: z.number().int().min(1).max(100_000).nullable(),
  managerEmployeeId: id.nullable(),
};
const endAfterStart = (p: { startDate: string | null; endDate: string | null }, ctx: z.RefinementCtx) => {
  if (p.startDate && p.endDate && p.endDate < p.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Must be on or after the start" });
};
export const projectSchema = z.object(projectShape).superRefine(endAfterStart);
export type ProjectInput = z.output<typeof projectSchema>;
export const updateProjectSchema = z.object({ ...projectShape, id }).superRefine(endAfterStart);

export const memberSchema = z.object({
  projectId: id,
  employeeIds: z.array(id).min(1, "Choose at least one employee").max(200),
  role: optionalText(60),
});

const weekStart = z.string().trim().refine(isWeekStart, "Weeks start on a Monday");

export const weekRowSchema = z.object({
  projectId: id,
  taskCategoryId: id,
  billable: z.boolean(),
  notes: z.string().trim().max(300),
  /** Minutes per date; quarter hours from 0 to 24 h. */
  minutes: z.record(
    z.string().refine(isISODate, "Enter a valid date"),
    z.number().int().min(0).max(DAY_MINUTES).refine(isQuarterHour, "Use quarter hours"),
  ),
});
export type WeekRowInput = z.output<typeof weekRowSchema>;

export const weekSaveSchema = z
  .object({
    weekStart,
    rows: z.array(weekRowSchema).max(60, "At most 60 rows"),
    /** The week's `updated_at` when the grid was opened (null: no timesheet yet); a later change refuses the save. */
    version: z.string().max(40).nullable().optional(),
  })
  .superRefine((week, ctx) => {
    if (!isWeekStart(week.weekStart)) return;
    const days = new Set(weekDates(week.weekStart));
    if (week.rows.some((r) => Object.keys(r.minutes).some((d) => !days.has(d)))) {
      ctx.addIssue({ code: "custom", path: ["rows"], message: "Every date must be in this week" });
    }
    const keys = week.rows.map((r) => `${r.projectId}:${r.taskCategoryId}`);
    if (new Set(keys).size !== keys.length) ctx.addIssue({ code: "custom", path: ["rows"], message: "Each project and category once" });
  });
export type WeekSaveInput = z.output<typeof weekSaveSchema>;

export const weekSchema = z.object({ weekStart });

export const timerStartSchema = z.object({ projectId: id, taskCategoryId: id, notes: optionalText(300) });
export type TimerStartInput = z.output<typeof timerStartSchema>;

export const timesheetDecisionSchema = z
  .object({ timesheetId: id, decision: z.enum(["approved", "rejected"]), note: optionalText(300) })
  .superRefine((d, ctx) => {
    if (d.decision === "rejected" && (d.note?.length ?? 0) < 3) ctx.addIssue({ code: "custom", path: ["note"], message: "Say what needs fixing" });
  });

export const bulkApproveTimesheetsSchema = z.object({
  timesheetIds: z.array(id).min(1).max(100),
  note: optionalText(300),
});
