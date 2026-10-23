import { z } from "zod";
import { ATTENDANCE_MODES, ATTENDANCE_STATUSES, COMP_OFF_RESOLUTIONS, WORK_MODES } from "@/lib/attendance";
import { parseHm } from "@/lib/dates";
import { isHalfStep } from "@/lib/leave";
import { isoDate, optionalText } from "./employees";
import { compOffSettingsSchema } from "./settings";

const id = z.number().int().positive();
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const hm = z.string().trim().regex(HM, "Use HH:MM (24-hour)");
const minutes = (max: number) => z.number().int().min(0).max(max);

export const shiftSchema = z
  .object({
    name: z.string().trim().min(1, "Required").max(60),
    startTime: hm,
    endTime: hm,
    breakMinutes: minutes(240),
    graceMinutes: minutes(240),
    halfDayMinutes: minutes(1440),
    fullDayMinutes: minutes(1440),
    weeklyOffs: z
      .array(z.number().int().min(0).max(6))
      .max(6, "Leave at least one working day")
      .refine((days) => new Set(days).size === days.length, "Each day once")
      .transform((days) => [...days].sort((a, b) => a - b)),
    attendanceMode: z.enum(ATTENDANCE_MODES),
    autoClockOutTime: z
      .string()
      .trim()
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || HM.test(v), "Use HH:MM (24-hour)"),
  })
  .superRefine((s, ctx) => {
    if (!HM.test(s.startTime) || !HM.test(s.endTime)) return;
    const start = parseHm(s.startTime);
    const end = parseHm(s.endTime);
    if (end <= start) {
      ctx.addIssue({ code: "custom", path: ["endTime"], message: "Must be after the start (shifts can't cross midnight)" });
      return;
    }
    if (s.halfDayMinutes >= s.fullDayMinutes) {
      ctx.addIssue({ code: "custom", path: ["halfDayMinutes"], message: "Must be less than a full day" });
    }
    if (s.fullDayMinutes > end - start) {
      ctx.addIssue({ code: "custom", path: ["fullDayMinutes"], message: "Can't be longer than the shift" });
    }
    if (s.autoClockOutTime && HM.test(s.autoClockOutTime) && parseHm(s.autoClockOutTime) < end) {
      ctx.addIssue({ code: "custom", path: ["autoClockOutTime"], message: "Must be at or after the shift end" });
    }
  });
export type ShiftInput = z.output<typeof shiftSchema>;

export const punchSchema = z.object({ workMode: z.enum(WORK_MODES) });

export const regularizationSchema = z
  .object({
    date: isoDate,
    requestedIn: hm.transform(parseHm),
    requestedOut: hm.transform(parseHm),
    reason: z.string().trim().min(3, "Say what happened").max(300),
  })
  .superRefine((r, ctx) => {
    if (r.requestedOut <= r.requestedIn) ctx.addIssue({ code: "custom", path: ["requestedOut"], message: "Must be after the in time" });
  });
export type RegularizationInput = z.output<typeof regularizationSchema>;

export const decisionSchema = z.object({
  id,
  decision: z.enum(["approved", "rejected"]),
  note: optionalText(300),
});

export const overrideSchema = z
  .object({
    employeeId: id,
    date: isoDate,
    /** null clears the override. */
    status: z.enum(ATTENDANCE_STATUSES).nullable(),
    note: z.string().trim().max(300),
  })
  .superRefine((o, ctx) => {
    if (o.status !== null && o.note.length < 3) ctx.addIssue({ code: "custom", path: ["note"], message: "Explain the override" });
  });
export type OverrideInput = z.output<typeof overrideSchema>;

export const compOffClaimSchema = z.object({ workedDate: isoDate, reason: optionalText(300) });

export const compOffDecisionSchema = z.object({
  claimId: id,
  decision: z.enum(["approved", "rejected"]),
  resolution: z.enum(COMP_OFF_RESOLUTIONS).default("leave"),
  note: optionalText(300),
});

export const compOffGrantSchema = z.object({
  employeeId: id,
  days: z.number().min(0.5).max(5).refine(isHalfStep, "Use steps of 0.5 days"),
  earnedOn: isoDate,
  note: z.string().trim().min(3, "Say why").max(300),
});
export type CompOffGrantInput = z.output<typeof compOffGrantSchema>;

export const attendanceSettingsFormSchema = z.object({
  defaultMode: z.enum(ATTENDANCE_MODES),
  regularizationWindowDays: z.number().int().min(0).max(365),
  defaultShiftId: id,
});

export const compOffSettingsFormSchema = compOffSettingsSchema.superRefine((s, ctx) => {
  if (s.halfDayMinutes !== null && s.fullDayMinutes !== null && s.halfDayMinutes >= s.fullDayMinutes) {
    ctx.addIssue({ code: "custom", path: ["halfDayMinutes"], message: "Must be less than the full-day threshold" });
  }
});
