import { z } from "zod";
import { EMPLOYMENT_TYPES, GENDERS } from "@/lib/hr";
import { isoDate, optionalDate, optionalEmail, optionalPhone, optionalText } from "./employees";

export const IMPORT_COLUMNS = [
  "employee_code", "first_name", "last_name", "work_email", "personal_email", "phone", "date_of_birth", "gender",
  "department", "designation", "manager_email", "employment_type", "work_location", "date_of_joining",
  "probation_end_date", "notice_period_days",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export const REQUIRED_IMPORT_COLUMNS: readonly ImportColumn[] = ["first_name", "date_of_joining"];
export const MAX_IMPORT_ROWS = 500;

export const IMPORT_TEMPLATE_CSV =
  [
    IMPORT_COLUMNS.join(","),
    "PV0101,Asha,Rao,asha.rao@pvcon.in,asha@example.com,+91 98450 12345,1992-04-18,female,Engineering,Consultant,,full_time,Pune,2026-10-01,2027-03-31,30",
    ",Ravi,Menon,ravi.menon@pvcon.in,,,,,Engineering,Consultant,asha.rao@pvcon.in,full_time,Pune,2026-10-05,,30",
  ].join("\n") + "\n";

/** Case-insensitive enum column: blank → null. */
function oneOf<T extends string>(values: readonly T[]) {
  return optionalText(40)
    .transform((v) => v?.toLowerCase() ?? null)
    .refine((v) => v === null || (values as readonly string[]).includes(v), `must be one of: ${values.join(", ")}`)
    .transform((v) => v as T | null);
}

export const importRowSchema = z.object({
  employee_code: optionalText(20)
    .refine((v) => v === null || /^[A-Za-z0-9-]+$/.test(v), "letters, digits and dashes only")
    .transform((v) => v?.toUpperCase() ?? null),
  first_name: z.string().trim().min(1, "is required").max(60),
  last_name: z.string().trim().max(60),
  work_email: optionalEmail,
  personal_email: optionalEmail,
  phone: optionalPhone,
  date_of_birth: optionalDate,
  gender: oneOf(GENDERS),
  department: optionalText(80),
  designation: optionalText(80),
  manager_email: optionalEmail,
  employment_type: oneOf(EMPLOYMENT_TYPES).transform((v) => v ?? "full_time"),
  work_location: optionalText(80),
  date_of_joining: isoDate,
  probation_end_date: optionalDate,
  notice_period_days: optionalText(3)
    .refine((v) => v === null || (/^\d{1,3}$/.test(v) && Number(v) <= 365), "must be a whole number from 0 to 365")
    .transform((v) => (v === null ? 30 : Number(v))),
});
