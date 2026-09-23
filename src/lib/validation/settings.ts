import { z } from "zod";

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const companySettingsSchema = z.object({
  legalName: z.string().trim().min(1, "Required").max(200),
  displayName: z.string().trim().min(1, "Required").max(100),
  address: z.string().trim().max(500),
  logoFileId: z.number().int().positive().nullable(),
});

export const localeSettingsSchema = z.object({
  timezone: z.string().refine(isValidTimeZone, "Unknown time zone"),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code"),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
});

export const employeeSettingsSchema = z.object({
  codePrefix: z.string().regex(/^[A-Z]{1,5}$/, "1–5 uppercase letters"),
  codeDigits: z.number().int().min(3).max(6),
});

export const leaveSettingsSchema = z.object({
  yearStartMonth: z.number().int().min(1).max(12),
});

export const attendanceSettingsSchema = z.object({
  defaultMode: z.enum(["punch", "auto"]),
  regularizationWindowDays: z.number().int().min(0).max(365),
});

export const compOffSettingsSchema = z.object({
  enabled: z.boolean(),
  /** null = use the employee's shift half-day threshold */
  halfDayMinutes: z.number().int().min(30).max(1440).nullable(),
  /** null = use the employee's shift full-day threshold */
  fullDayMinutes: z.number().int().min(30).max(1440).nullable(),
  claimWindowDays: z.number().int().min(1).max(365),
  expiryDays: z.number().int().min(1).max(730),
  payoutEnabled: z.boolean(),
});

export const payrollSettingsSchema = z.object({
  prorationBasis: z.enum(["calendar", "working"]),
  payDay: z.number().int().min(1).max(31),
  payslipFooter: z.string().max(500),
  varianceThresholdPct: z.number().min(0).max(100),
  signatoryEnabled: z.boolean(),
  signatoryName: z.string().max(100),
  signatoryDesignation: z.string().max(100),
  signatoryImageFileId: z.number().int().positive().nullable(),
  emailAttachment: z.enum(["none", "protected"]),
  pdfPasswordFormat: z.enum(["dob_ddmmyyyy", "employee_code"]),
});

export const securitySettingsSchema = z.object({
  lockoutAttempts: z.number().int().min(3).max(20),
  lockoutMinutes: z.number().int().min(1).max(1440),
  passwordMinLength: z.number().int().min(8).max(64),
});

function defineSetting<S extends z.ZodType>(schema: S, defaults: z.output<S>) {
  return { schema, defaults };
}

export const SETTINGS = {
  company: defineSetting(companySettingsSchema, {
    legalName: "PVCON Consulting",
    displayName: "PVCON",
    address: "",
    logoFileId: null,
  }),
  locale: defineSetting(localeSettingsSchema, {
    timezone: "Asia/Kolkata",
    currency: "INR",
    fiscalYearStartMonth: 4,
  }),
  employee: defineSetting(employeeSettingsSchema, { codePrefix: "PV", codeDigits: 4 }),
  leave: defineSetting(leaveSettingsSchema, { yearStartMonth: 1 }),
  attendance: defineSetting(attendanceSettingsSchema, { defaultMode: "punch", regularizationWindowDays: 30 }),
  compOff: defineSetting(compOffSettingsSchema, {
    enabled: true,
    halfDayMinutes: null,
    fullDayMinutes: null,
    claimWindowDays: 30,
    expiryDays: 90,
    payoutEnabled: false,
  }),
  payroll: defineSetting(payrollSettingsSchema, {
    prorationBasis: "calendar",
    payDay: 1,
    payslipFooter: "",
    varianceThresholdPct: 10,
    signatoryEnabled: false,
    signatoryName: "",
    signatoryDesignation: "",
    signatoryImageFileId: null,
    emailAttachment: "none",
    pdfPasswordFormat: "dob_ddmmyyyy",
  }),
  security: defineSetting(securitySettingsSchema, {
    lockoutAttempts: 5,
    lockoutMinutes: 15,
    passwordMinLength: 10,
  }),
};

export type SettingsKey = keyof typeof SETTINGS;
export type SettingsValue<K extends SettingsKey> = z.output<(typeof SETTINGS)[K]["schema"]>;
