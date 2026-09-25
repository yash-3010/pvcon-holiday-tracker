import { z } from "zod";
import { ROLES } from "@/lib/auth/permissions";
import { isISODate } from "@/lib/dates";
import { DOCUMENT_CATEGORIES, EMPLOYMENT_TYPES, GENDERS, MARITAL_STATUSES } from "@/lib/hr";

/** Optional form text: trims, and turns "" (or null) into null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max} characters`)
    .nullable()
    .transform((v) => (v ? v : null));

export const isoDate = z.string().trim().refine(isISODate, "Enter a valid date");

export const optionalDate = z
  .string()
  .trim()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isISODate(v), "Enter a valid date");

const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

export const optionalPhone = optionalText(20).refine((v) => v === null || PHONE_RE.test(v), "Enter a valid phone number");

export const optionalEmail = optionalText(254)
  .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email")
  .transform((v) => v?.toLowerCase() ?? null);

const addressSchema = z
  .object({
    line1: z.string().trim().max(120),
    line2: z.string().trim().max(120),
    city: z.string().trim().max(60),
    state: z.string().trim().max(60),
    postalCode: z.string().trim().max(12),
    country: z.string().trim().max(60),
  })
  .nullable()
  .transform((a) => (a && Object.values(a).some(Boolean) ? a : null));

const emergencyContactSchema = z
  .object({
    name: z.string().trim().max(100),
    relation: z.string().trim().max(40),
    phone: z.string().trim().max(20).refine((v) => v === "" || PHONE_RE.test(v), "Enter a valid phone number"),
  })
  .nullable()
  .transform((c) => (c && Object.values(c).some(Boolean) ? c : null));

const personalShape = {
  firstName: z.string().trim().min(1, "Required").max(60),
  lastName: z.string().trim().max(60),
  displayName: optionalText(120),
  workEmail: optionalEmail,
  personalEmail: optionalEmail,
  phone: optionalPhone,
  dateOfBirth: optionalDate,
  gender: z.enum(GENDERS).nullable(),
  maritalStatus: z.enum(MARITAL_STATUSES).nullable(),
  address: addressSchema,
  emergencyContact: emergencyContactSchema,
};

const jobShape = {
  departmentId: z.number().int().positive().nullable(),
  designationId: z.number().int().positive().nullable(),
  reportingManagerId: z.number().int().positive().nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  workLocation: optionalText(80),
  dateOfJoining: isoDate,
  probationEndDate: optionalDate,
  confirmationDate: optionalDate,
  noticePeriodDays: z.number({ error: "Enter a number" }).int().min(0, "0 or more").max(365, "At most 365"),
};

const bankShape = {
  bankName: optionalText(80),
  bankAccount: optionalText(34)
    .transform((v) => v?.replace(/\s+/g, "") ?? null)
    .refine((v) => v === null || /^[0-9]{6,20}$/.test(v), "6–20 digits"),
  bankIfsc: optionalText(11)
    .transform((v) => v?.toUpperCase() ?? null)
    .refine((v) => v === null || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v), "Use an 11-character IFSC, e.g. HDFC0001234"),
  pan: optionalText(10)
    .transform((v) => v?.toUpperCase() ?? null)
    .refine((v) => v === null || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), "Use a 10-character PAN, e.g. ABCDE1234F"),
  aadhaar: optionalText(14)
    .transform((v) => v?.replace(/\s+/g, "") ?? null)
    .refine((v) => v === null || /^[0-9]{12}$/.test(v), "12 digits"),
  passport: optionalText(12)
    .transform((v) => v?.toUpperCase() ?? null)
    .refine((v) => v === null || /^[A-Z0-9]{6,12}$/.test(v), "6–12 letters or digits"),
};

function checkJobDates(
  v: { dateOfJoining: string; probationEndDate: string | null; confirmationDate: string | null },
  ctx: z.RefinementCtx,
): void {
  for (const key of ["probationEndDate", "confirmationDate"] as const) {
    const value = v[key];
    if (value && value < v.dateOfJoining) {
      ctx.addIssue({ code: "custom", path: [key], message: "Must be on or after the joining date" });
    }
  }
}

export const personalSchema = z.object(personalShape);
export type PersonalInput = z.output<typeof personalSchema>;

/** The fields employees may change on their own profile without approval (spec §5.1). */
export const contactSchema = z.object({
  personalEmail: personalShape.personalEmail,
  phone: personalShape.phone,
  address: personalShape.address,
  emergencyContact: personalShape.emergencyContact,
});
export type ContactInput = z.output<typeof contactSchema>;

export const jobSchema = z.object(jobShape).superRefine(checkJobDates);
export type JobInput = z.output<typeof jobSchema>;

export const bankSchema = z.object(bankShape);
export type BankInput = z.output<typeof bankSchema>;

export const LOGIN_MODES = ["none", "create", "link"] as const;
export type LoginMode = (typeof LOGIN_MODES)[number];

export const createEmployeeSchema = z
  .object({
    ...personalShape,
    ...jobShape,
    ...bankShape,
    employeeCode: optionalText(20)
      .refine((v) => v === null || /^[A-Za-z0-9-]+$/.test(v), "Letters, digits and dashes only")
      .transform((v) => v?.toUpperCase() ?? null),
    loginMode: z.enum(LOGIN_MODES),
    loginRoles: z.array(z.enum(ROLES)).max(ROLES.length),
    linkUserId: z.number().int().positive().nullable(),
  })
  .superRefine((v, ctx) => {
    checkJobDates(v, ctx);
    if (v.loginMode === "create") {
      if (!v.workEmail) ctx.addIssue({ code: "custom", path: ["workEmail"], message: "Required to create a login" });
      if (v.loginRoles.length === 0) ctx.addIssue({ code: "custom", path: ["loginRoles"], message: "Pick at least one role" });
    }
    if (v.loginMode === "link" && !v.linkUserId) {
      ctx.addIssue({ code: "custom", path: ["linkUserId"], message: "Choose a user to link" });
    }
  });
export type CreateEmployeeInput = z.output<typeof createEmployeeSchema>;
export type CreateEmployeeFormValues = z.input<typeof createEmployeeSchema>;

export const resignationSchema = z
  .object({
    resignationDate: isoDate,
    lastWorkingDate: isoDate,
    exitReason: optionalText(500),
  })
  .refine((v) => v.lastWorkingDate >= v.resignationDate, {
    path: ["lastWorkingDate"],
    message: "Must be on or after the resignation date",
  });
export type ResignationInput = z.output<typeof resignationSchema>;

/** Metadata sent alongside an uploaded document (FormData values arrive as strings). */
export const documentMetaSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  category: z.enum(DOCUMENT_CATEGORIES),
  title: z.string().trim().min(2, "At least 2 characters").max(120),
});

export const bankChangeRequestSchema = z.object({ ...bankShape, reason: optionalText(300) });
export type BankChangeRequestInput = z.output<typeof bankChangeRequestSchema>;
