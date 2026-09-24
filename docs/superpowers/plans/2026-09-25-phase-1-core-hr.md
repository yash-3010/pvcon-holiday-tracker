# Phase 1 — Core HR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Core HR for PVCON People. That covers:
- org masters (departments, designations);
- the employee master with onboarding, job and personal edits, bank/ID data and exit;
- manager scope from reporting lines;
- documents and onboarding/offboarding checklists;
- self-service profile with HR-approved bank/ID changes;
- CSV bulk import, a directory and an org chart.

**Architecture:**
- New Drizzle tables live in `src/server/db/schema/core.ts`.
- Synchronous services live in `src/server/modules/org/*` and `src/server/modules/employees/*`.
- Mutations are server actions built with `defineAction`. Pages are Server Components that call `requireUser`/`requirePermission` and module queries.
- A recursive-CTE reporting tree gives manager scope. It feeds `SessionUser.employeeId`/`hasReports` and `isInScope()`.

**Tech Stack:** Phase 0 stack (Next.js 16, React 19, Drizzle 0.45 on better-sqlite3, zod 4, react-hook-form, radix-ui, `@tanstack/react-table` v8) plus `papaparse` for CSV import.

**Spec:** `docs/superpowers/specs/2026-09-24-hrms-overhaul-design.md`, sections:
- §3.2 (manager scope);
- §4.2 (Core HR tables);
- §5.1 (Core HR behaviour);
- §5.7 (profile-change approvals);
- §6 (routes `/org/*`, `/me/profile`, `/me/documents`).

Roadmap Phase 1 (`docs/superpowers/plans/2026-09-24-hrms-roadmap.md`) lists the task outline. Where the roadmap and the spec differ, the spec wins; see "Spec refinements" in Task 20.

**Prerequisite:** Phase 0 is complete (0A + 0B). Use the Phase 0 names exactly:
- `defineAction`, `executeAction`, `requireUser`, `requirePermission`, `requireAnyPermission`, `getCurrentUser`;
- `writeAudit`, `diffObjects`, `notify`, `notifyMany`, `getSetting`, `patchSetting`;
- `saveUpload`, `getFile`, `canAccessFile`, `createUser`, `assertCanGrantRoles`, `hashPassword`, `generateTempPassword`;
- `NAV`/`visibleNav`, `useServerAction`, `applyFieldErrors`, and the `src/components/ui/*` primitives.

## Global Constraints

- Services are synchronous. Every service function takes `db: DbLike` first and uses Drizzle's sync API. Never `await` inside a transaction.
- Every mutation goes through `defineAction` and calls `audit(...)`.
- `executeAction` already refuses users whose `mustChangePassword` is set (roadmap refinement 11).
- Calendar dates are `YYYY-MM-DD` strings handled with `src/lib/dates.ts`. "Today" is `todayInTimeZone(getSetting(db, "locale").timezone)`. Never call `toISOString()` on a local-midnight `Date`.
- Bank account numbers and ID numbers are stored with AES-256-GCM (`encrypt`/`decrypt` in `src/server/lib/crypto.ts`).
  - The UI shows masked values (`XXXX1234`) unless the viewer has `employee.sensitive.view` (spec §3.4).
  - Encrypted columns never leave the server.
- Employees are never hard-deleted (status → `exited`). Master data is archived, not deleted (spec §2.4).
- Employee codes auto-increment: the `employee.codePrefix` setting (default `PV`) plus zero-padded `employee.codeDigits` (default 4), e.g. `PV0001` (spec §5.1).
- Every job-affecting change (department, designation, manager) creates an `employee_events` row (spec §5.1).
- Schema files use relative imports only. Generate migrations with `npm run db:generate -- --name <change>` and never hand-edit generated SQL.
- Uploads go only through `saveUpload()`. Downloads go only through `/api/files/[id]`, gated by a resolver in `src/server/modules/files/access.ts`.
- Next 16: `params` and `searchParams` are Promises. `forbidden()`/`notFound()` come from `next/navigation`.
- lucide-react 1.x canonical icon names only. Every icon used below exists in the installed version.
- `@tanstack/react-table` stays on v8. Do not use `xlsx`.

## Review Focus

These are the five inputs or conditions most likely to hurt a real user. The spec implies them but does not spell them out. Each one has a pinned test in the task that owns the code.

1. **Reporting-line cycles.**
   - Making someone report to their own direct or indirect report must be refused.
   - The tree queries and org chart must terminate and show every employee even when stored data already contains a cycle (e.g. an old import).
   - Tests: Task 5 (`getReportingTree` stays finite on a cycle), Task 7 (`MANAGER_CYCLE`), Task 8 (org chart includes cycle members).
2. **Scope leaks by URL guessing.**
   - A manager sees only their reporting tree.
   - An employee cannot read another employee's profile, documents or files by changing an id.
   - Tests: Task 5 (`isInScope`), Task 10 (file resolver denies a peer), Task 15 (profile actions refuse out-of-scope ids).
3. **Sensitive values leaking unmasked.**
   - Bank account and ID numbers must never reach the client, the audit log or a notification in clear text unless the viewer holds `employee.sensitive.view`.
   - Tests: Task 8 (detail query has no `*Enc` fields and masks by default), Task 11 (approval audit diff and pending list are masked without reveal).
4. **Exit timing in the company time zone.**
   - The nightly lifecycle job runs at 00:30 IST (19:00 UTC the day before). It must exit an employee on LWD + 1 in `Asia/Kolkata`, not in UTC, and a second run the same day must do nothing.
   - Test: Task 9 (runs `employee:lifecycle` at `2026-10-01T19:00:00Z`).
5. **Real-world CSV files.**
   - Imports must cope with a UTF-8 BOM, Windows line endings, header case and spaces, trailing blank lines, duplicate emails inside the file, and a manager defined on a later row.
   - Commit is all-or-nothing.
   - Test: Task 12.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/hr.ts` | Core HR enums, labels, JSON shapes, `fullName`, `formatAddress` (isomorphic) |
| `src/lib/validation/org.ts` | zod schemas: department, designation, checklist template |
| `src/lib/validation/employees.ts` | zod schemas: personal, contact, job, bank, create-employee, resignation, document meta, bank-change request |
| `src/lib/validation/employee-import.ts` | CSV columns, template, per-row schema |
| `src/lib/auth/permissions.ts` | + `TEAM_APPROVAL_PERMISSIONS`, `permissionsForUser` |
| `src/lib/auth/types.ts` | + `SessionUser.employeeId`, `SessionUser.hasReports` |
| `src/server/db/schema/core.ts` | departments, designations, employees, employee_documents, employee_events, checklist_templates, employee_checklists, profile_change_requests |
| `src/server/modules/org/service.ts`, `queries.ts` | Departments/designations CRUD + archive; list/option queries |
| `src/server/modules/employees/code.ts` | `nextEmployeeCode` |
| `src/server/modules/employees/sensitive.ts` | Seal/open/mask bank account and ID numbers |
| `src/server/modules/employees/scope.ts` | Reporting tree, session employee context, `isInScope`, `canViewEmployee`, `viewableEmployeeIds` |
| `src/server/modules/employees/checklists.ts` | Checklist templates + per-employee checklists |
| `src/server/modules/employees/service.ts` | Create, job/personal/contact/bank updates, login link/create, events |
| `src/server/modules/employees/queries.ts` | List, detail, directory, org chart, events, pickers |
| `src/server/modules/employees/lifecycle.ts` | Resignation, withdrawal, exits, probation reminders |
| `src/server/modules/employees/documents.ts` | Employee documents |
| `src/server/modules/employees/profile-changes.ts` | Bank/ID change requests |
| `src/server/modules/employees/import.ts` | CSV preview + commit |
| `src/server/jobs/employee-lifecycle.ts` | `employee:lifecycle` job |
| `src/components/employees/*` | Shared field sections, badges, timeline, checklist and document cards |
| `src/components/users/{role-picker,temp-password-dialog}.tsx` | Moved from `settings/users` for reuse |
| `src/app/(app)/org/**` | Employees, wizard, profile, directory, chart, departments, designations, checklists, import |
| `src/app/(app)/me/{profile,documents}/*` | Self-service |
| `src/app/(app)/approvals/*` | Approvals inbox (Profile changes tab) |
| `src/app/(app)/settings/employee/*` | Employee code settings |
| `tests/helpers/employees.ts` | Raw-insert fixtures for employees, departments, designations |
| `tests/e2e/helpers.ts`, `tests/e2e/core-hr.spec.ts` | E2E |

---

### Task 1: Core HR constants and validation schemas

**Files:**
- Create: `src/lib/hr.ts`, `src/lib/validation/org.ts`, `src/lib/validation/employees.ts`
- Test: `tests/unit/lib/hr-validation.test.ts`

**Interfaces:**
- Consumes: `isISODate` (`src/lib/dates.ts`), `ROLES` (`src/lib/auth/permissions.ts`).
- Produces:
  - `src/lib/hr.ts`: `EMPLOYMENT_TYPES`/`EmploymentType`/`EMPLOYMENT_TYPE_LABELS`, `EMPLOYEE_STATUSES`/`EmployeeStatus`/`EMPLOYEE_STATUS_LABELS`, `GENDERS`/`Gender`/`GENDER_LABELS`, `MARITAL_STATUSES`/`MaritalStatus`/`MARITAL_STATUS_LABELS`, `DOCUMENT_CATEGORIES`/`DocumentCategory`/`DOCUMENT_CATEGORY_LABELS`, `SELF_DOCUMENT_CATEGORIES`, `EMPLOYEE_EVENT_TYPES`/`EmployeeEventType`/`EMPLOYEE_EVENT_LABELS`, `CHECKLIST_KINDS`/`ChecklistKind`/`CHECKLIST_KIND_LABELS`, `CHECKLIST_OWNERS`/`ChecklistOwner`/`CHECKLIST_OWNER_LABELS`, `PROFILE_CHANGE_STATUSES`/`ProfileChangeStatus`, types `Address`, `EmergencyContact`, `IdNumbers`, `ChecklistTemplateItem`, `ChecklistItemState`, `EventValues`, `SelectOption`, functions `fullName(first, last)`, `formatAddress(address)`.
  - `src/lib/validation/org.ts`: `departmentSchema`/`DepartmentInput`, `designationSchema`/`DesignationInput`, `checklistTemplateSchema`/`ChecklistTemplateInput`.
  - `src/lib/validation/employees.ts`: `optionalText(max)`, `isoDate`, `optionalDate`, `optionalPhone`, `optionalEmail`, `personalSchema`/`PersonalInput`, `contactSchema`/`ContactInput`, `jobSchema`/`JobInput`, `bankSchema`/`BankInput`, `LOGIN_MODES`/`LoginMode`, `createEmployeeSchema`/`CreateEmployeeInput`/`CreateEmployeeFormValues`, `resignationSchema`/`ResignationInput`, `documentMetaSchema`, `bankChangeRequestSchema`/`BankChangeRequestInput`.

- [ ] **Step 1: Write the failing tests** — `tests/unit/lib/hr-validation.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatAddress, fullName } from "@/lib/hr";
import { departmentSchema } from "@/lib/validation/org";
import {
  bankSchema, contactSchema, createEmployeeSchema, jobSchema, optionalText, resignationSchema,
} from "@/lib/validation/employees";

const fieldErrors = (result: { success: boolean; error?: z.ZodError }) =>
  result.success ? {} : (z.flattenError(result.error!).fieldErrors as Record<string, string[]>);

const job = {
  departmentId: null, designationId: null, reportingManagerId: null, employmentType: "full_time",
  workLocation: "", dateOfJoining: "2026-10-01", probationEndDate: "", confirmationDate: "", noticePeriodDays: 30,
};
const personal = {
  firstName: "Asha", lastName: "Rao", displayName: "", workEmail: "Asha.Rao@PVCON.in", personalEmail: "",
  phone: "", dateOfBirth: "", gender: null, maritalStatus: null,
  address: { line1: "", line2: "", city: "", state: "", postalCode: "", country: "" },
  emergencyContact: { name: "", relation: "", phone: "" },
};
const bank = { bankName: "", bankAccount: "", bankIfsc: "", pan: "", aadhaar: "", passport: "" };
const create = { ...personal, ...job, ...bank, employeeCode: "", loginMode: "none", loginRoles: [], linkUserId: null };

describe("hr helpers", () => {
  it("joins names and addresses without empty parts", () => {
    expect(fullName(" Asha ", "")).toBe("Asha");
    expect(fullName("Asha", "Rao")).toBe("Asha Rao");
    expect(formatAddress({ line1: "12 MG Road", line2: "", city: "Pune", state: "MH", postalCode: "411001", country: "India" }))
      .toBe("12 MG Road, Pune MH 411001, India");
    expect(formatAddress(null)).toBe("");
  });
});

describe("employee validation", () => {
  it("turns blank optional text into null and trims the rest", () => {
    expect(optionalText(10).parse("")).toBeNull();
    expect(optionalText(10).parse("  x  ")).toBe("x");
    expect(optionalText(10).parse(null)).toBeNull();
  });

  it("normalises bank and ID numbers", () => {
    const parsed = bankSchema.parse({
      bankName: " HDFC Bank ", bankAccount: "1234 5678 9012", bankIfsc: "hdfc0001234",
      pan: "abcde1234f", aadhaar: "1234 5678 9012", passport: "",
    });
    expect(parsed).toEqual({
      bankName: "HDFC Bank", bankAccount: "123456789012", bankIfsc: "HDFC0001234",
      pan: "ABCDE1234F", aadhaar: "123456789012", passport: null,
    });
  });

  it("rejects malformed IFSC, PAN and account numbers", () => {
    const errors = fieldErrors(bankSchema.safeParse({ ...bank, bankAccount: "12ab", bankIfsc: "HDFC1234", pan: "12345" }));
    expect(Object.keys(errors).sort()).toEqual(["bankAccount", "bankIfsc", "pan"]);
  });

  it("keeps probation and confirmation on or after the joining date", () => {
    const errors = fieldErrors(jobSchema.safeParse({ ...job, probationEndDate: "2026-09-30", confirmationDate: "2026-09-01" }));
    expect(errors.probationEndDate).toEqual(["Must be on or after the joining date"]);
    expect(errors.confirmationDate).toEqual(["Must be on or after the joining date"]);
  });

  it("drops an all-blank address or emergency contact", () => {
    const parsed = contactSchema.parse({ personalEmail: "", phone: "+91 98450 12345", address: personal.address, emergencyContact: personal.emergencyContact });
    expect(parsed).toEqual({ personalEmail: null, phone: "+91 98450 12345", address: null, emergencyContact: null });
  });

  it("lower-cases emails and validates phone numbers", () => {
    expect(createEmployeeSchema.parse(create).workEmail).toBe("asha.rao@pvcon.in");
    expect(fieldErrors(contactSchema.safeParse({ ...personal, phone: "call me" })).phone).toEqual(["Enter a valid phone number"]);
  });

  it("requires a work email and roles to create a login, and a user to link one", () => {
    expect(createEmployeeSchema.safeParse(create).success).toBe(true);
    const noEmail = fieldErrors(createEmployeeSchema.safeParse({ ...create, workEmail: "", loginMode: "create", loginRoles: [] }));
    expect(noEmail.workEmail).toEqual(["Required to create a login"]);
    expect(noEmail.loginRoles).toEqual(["Pick at least one role"]);
    expect(fieldErrors(createEmployeeSchema.safeParse({ ...create, loginMode: "link" })).linkUserId).toEqual(["Choose a user to link"]);
  });

  it("upper-cases an explicit employee code and rejects odd characters", () => {
    expect(createEmployeeSchema.parse({ ...create, employeeCode: "pv0042" }).employeeCode).toBe("PV0042");
    expect(fieldErrors(createEmployeeSchema.safeParse({ ...create, employeeCode: "PV 42" })).employeeCode).toBeDefined();
  });

  it("keeps the last working date on or after the resignation date", () => {
    const errors = fieldErrors(resignationSchema.safeParse({ resignationDate: "2026-10-10", lastWorkingDate: "2026-10-09", exitReason: "" }));
    expect(errors.lastWorkingDate).toEqual(["Must be on or after the resignation date"]);
  });
});

describe("org validation", () => {
  it("upper-cases department codes and turns blanks into null", () => {
    expect(departmentSchema.parse({ name: "Engineering", code: "eng-1", parentId: null, headEmployeeId: null }).code).toBe("ENG-1");
    expect(departmentSchema.parse({ name: "Engineering", code: "", parentId: null, headEmployeeId: null }).code).toBeNull();
    expect(departmentSchema.safeParse({ name: "Engineering", code: "en g", parentId: null, headEmployeeId: null }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/lib/hr-validation.test.ts`
Expected: FAIL — `Cannot find package '@/lib/hr'`.

- [ ] **Step 3: Create `src/lib/hr.ts`**

```ts
/** Core HR enums, labels and JSON shapes shared by the schema, services and UI. No imports: schema files use this. */

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "intern"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  intern: "Intern",
};

export const EMPLOYEE_STATUSES = ["active", "on_notice", "exited"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  active: "Active",
  on_notice: "On notice",
  exited: "Exited",
};

export const GENDERS = ["female", "male", "non_binary", "undisclosed"] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {
  female: "Female",
  male: "Male",
  non_binary: "Non-binary",
  undisclosed: "Prefer not to say",
};

export const MARITAL_STATUSES = ["single", "married", "divorced", "widowed", "undisclosed"] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];
export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  single: "Single",
  married: "Married",
  divorced: "Divorced",
  widowed: "Widowed",
  undisclosed: "Prefer not to say",
};

export const DOCUMENT_CATEGORIES = [
  "offer_letter", "id_proof", "address_proof", "education", "experience", "contract", "other",
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  offer_letter: "Offer letter",
  id_proof: "ID proof",
  address_proof: "Address proof",
  education: "Education",
  experience: "Experience",
  contract: "Contract",
  other: "Other",
};
/** Categories employees may upload for themselves; HR supplies offer letters and contracts. */
export const SELF_DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [
  "id_proof", "address_proof", "education", "experience", "other",
];

export const EMPLOYEE_EVENT_TYPES = [
  "joined", "confirmed", "promoted", "transferred", "manager_changed", "salary_revised", "resigned", "exited", "rehired",
] as const;
export type EmployeeEventType = (typeof EMPLOYEE_EVENT_TYPES)[number];
export const EMPLOYEE_EVENT_LABELS: Record<EmployeeEventType, string> = {
  joined: "Joined",
  confirmed: "Confirmed",
  promoted: "Designation changed",
  transferred: "Department changed",
  manager_changed: "Manager changed",
  salary_revised: "Salary revised",
  resigned: "Resigned",
  exited: "Exited",
  rehired: "Rehired",
};

export const CHECKLIST_KINDS = ["onboarding", "offboarding"] as const;
export type ChecklistKind = (typeof CHECKLIST_KINDS)[number];
export const CHECKLIST_KIND_LABELS: Record<ChecklistKind, string> = {
  onboarding: "Onboarding",
  offboarding: "Offboarding",
};

export const CHECKLIST_OWNERS = ["hr", "manager", "employee", "it"] as const;
export type ChecklistOwner = (typeof CHECKLIST_OWNERS)[number];
export const CHECKLIST_OWNER_LABELS: Record<ChecklistOwner, string> = {
  hr: "HR",
  manager: "Manager",
  employee: "Employee",
  it: "IT",
};

export const PROFILE_CHANGE_STATUSES = ["pending", "approved", "rejected", "withdrawn"] as const;
export type ProfileChangeStatus = (typeof PROFILE_CHANGE_STATUSES)[number];

export interface Address {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface EmergencyContact {
  name: string;
  relation: string;
  phone: string;
}

export interface IdNumbers {
  pan: string | null;
  aadhaar: string | null;
  passport: string | null;
}

export interface ChecklistTemplateItem {
  label: string;
  owner: ChecklistOwner;
}

export interface ChecklistItemState extends ChecklistTemplateItem {
  doneAt: string | null;
  doneBy: number | null;
  doneByName: string | null;
}

/** Human-readable before/after values stored on `employee_events`. */
export type EventValues = Record<string, string | number | null>;

/** A picker option (departments, designations, employees, users). */
export interface SelectOption {
  id: number;
  label: string;
}

export function fullName(first: string, last: string): string {
  return [first, last]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

export function formatAddress(address: Address | null | undefined): string {
  if (!address) return "";
  const cityLine = [address.city, address.state, address.postalCode].map((s) => s.trim()).filter(Boolean).join(" ");
  return [address.line1, address.line2, cityLine, address.country]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}
```

- [ ] **Step 4: Create `src/lib/validation/employees.ts`**

```ts
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
```

- [ ] **Step 5: Create `src/lib/validation/org.ts`**

```ts
import { z } from "zod";
import { CHECKLIST_KINDS, CHECKLIST_OWNERS } from "@/lib/hr";
import { optionalText } from "./employees";

export const departmentSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(80),
  code: optionalText(12)
    .refine((v) => v === null || /^[A-Za-z0-9-]+$/.test(v), "Letters, digits and dashes only")
    .transform((v) => v?.toUpperCase() ?? null),
  parentId: z.number().int().positive().nullable(),
  headEmployeeId: z.number().int().positive().nullable(),
});
export type DepartmentInput = z.output<typeof departmentSchema>;

export const designationSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(80),
  level: z.number().int().min(0).max(99).nullable(),
});
export type DesignationInput = z.output<typeof designationSchema>;

export const checklistTemplateSchema = z.object({
  kind: z.enum(CHECKLIST_KINDS),
  name: z.string().trim().min(2, "At least 2 characters").max(80),
  items: z
    .array(
      z.object({
        label: z.string().trim().min(2, "At least 2 characters").max(160),
        owner: z.enum(CHECKLIST_OWNERS),
      }),
    )
    .min(1, "Add at least one item")
    .max(50, "At most 50 items"),
  isDefault: z.boolean(),
});
export type ChecklistTemplateInput = z.output<typeof checklistTemplateSchema>;
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/unit/lib/hr-validation.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/hr.ts src/lib/validation/org.ts src/lib/validation/employees.ts tests/unit/lib/hr-validation.test.ts
git commit -m "feat(hr): add core HR constants and validation schemas"
```

---

### Task 2: Core HR schema, migration and fixtures

**Files:**
- Create: `src/server/db/schema/core.ts`, `tests/helpers/employees.ts`
- Modify: `src/server/db/schema/index.ts`
- Generate: `src/server/db/migrations/0001_core_hr.sql` (+ meta)
- Test: `tests/integration/db/core-schema.test.ts`

**Interfaces:**
- Consumes: `users` (`schema/auth.ts`), `files` (`schema/system.ts`), `timestamps`/`nowIso` (`columns.ts`), the enums and JSON types from `src/lib/hr.ts` (Task 1).
- Produces:
  - Tables `departments`, `designations`, `employees`, `employeeDocuments`, `employeeEvents`, `checklistTemplates`, `employeeChecklists`, `profileChangeRequests`.
  - Row types `DepartmentRow`, `DesignationRow`, `EmployeeRow`, `EmployeeDocumentRow`, `EmployeeEventRow`, `ChecklistTemplateRow`, `EmployeeChecklistRow`, `ProfileChangeRequestRow`.
  - Type `ProfileChangeFields`.
  - Test fixtures `insertEmployee(db, overrides?)`, `insertDepartment(db, name, overrides?)`, `insertDesignation(db, name, overrides?)`.

- [ ] **Step 1: Write the failing test** — `tests/integration/db/core-schema.test.ts`

```ts
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { employeeEvents } from "@/server/db/schema";
import { createTestDb } from "../../helpers/db";
import { insertDepartment, insertEmployee } from "../../helpers/employees";
import { insertUser } from "../../helpers/fixtures";

describe("core HR schema", () => {
  it("creates the core HR tables", () => {
    const db = createTestDb();
    const names = db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "departments", "designations", "employees", "employee_documents", "employee_events",
        "checklist_templates", "employee_checklists", "profile_change_requests",
      ]),
    );
  });

  it("keeps employee codes, work emails and linked logins unique", () => {
    const db = createTestDb();
    const user = insertUser(db);
    insertEmployee(db, { employeeCode: "PV0001", workEmail: "a@pvcon.in", userId: user.id });
    expect(() => insertEmployee(db, { employeeCode: "PV0001" })).toThrow(/UNIQUE/);
    expect(() => insertEmployee(db, { workEmail: "a@pvcon.in" })).toThrow(/UNIQUE/);
    expect(() => insertEmployee(db, { userId: user.id })).toThrow(/UNIQUE/);
    expect(() => insertEmployee(db, { workEmail: null })).not.toThrow();
    expect(() => insertEmployee(db, { workEmail: null })).not.toThrow();
  });

  it("rejects references to missing managers and departments", () => {
    const db = createTestDb();
    expect(() => insertEmployee(db, { reportingManagerId: 999 })).toThrow(/FOREIGN KEY/);
    expect(() => insertEmployee(db, { departmentId: 999 })).toThrow(/FOREIGN KEY/);
    const dept = insertDepartment(db, "Engineering");
    expect(insertEmployee(db, { departmentId: dept.id }).departmentId).toBe(dept.id);
  });

  it("defaults status, employment type and notice period", () => {
    const db = createTestDb();
    expect(insertEmployee(db)).toMatchObject({ status: "active", employmentType: "full_time", noticePeriodDays: 30 });
  });

  it("stores event values as JSON", () => {
    const db = createTestDb();
    const e = insertEmployee(db);
    const event = db
      .insert(employeeEvents)
      .values({ employeeId: e.id, type: "joined", effectiveDate: "2026-01-01", to: { department: "Engineering" } })
      .returning()
      .get();
    expect(event.to).toEqual({ department: "Engineering" });
    expect(event.from).toBeNull();
  });
});
```

- [ ] **Step 2: Create `tests/helpers/employees.ts`**

```ts
import { departments, designations, employees, type DepartmentRow, type DesignationRow, type EmployeeRow } from "@/server/db/schema";
import type { DbLike } from "@/server/db/client";

let seq = 0;

/** Raw insert for tests that need an employee row without the service's rules. */
export function insertEmployee(db: DbLike, overrides: Partial<typeof employees.$inferInsert> = {}): EmployeeRow {
  seq += 1;
  const firstName = overrides.firstName ?? `Emp${seq}`;
  const lastName = overrides.lastName ?? "Test";
  return db
    .insert(employees)
    .values({
      employeeCode: `T${String(seq).padStart(5, "0")}`,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      dateOfJoining: "2026-01-01",
      ...overrides,
    })
    .returning()
    .get();
}

export function insertDepartment(db: DbLike, name: string, overrides: Partial<typeof departments.$inferInsert> = {}): DepartmentRow {
  return db.insert(departments).values({ name, ...overrides }).returning().get();
}

export function insertDesignation(db: DbLike, name: string, overrides: Partial<typeof designations.$inferInsert> = {}): DesignationRow {
  return db.insert(designations).values({ name, ...overrides }).returning().get();
}
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/integration/db/core-schema.test.ts`
Expected: FAIL — `employeeEvents`/`employees` are not exported from `@/server/db/schema`.

- [ ] **Step 4: Create `src/server/db/schema/core.ts`**

```ts
import { index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import {
  CHECKLIST_KINDS, DOCUMENT_CATEGORIES, EMPLOYEE_EVENT_TYPES, EMPLOYEE_STATUSES, EMPLOYMENT_TYPES, GENDERS,
  MARITAL_STATUSES, PROFILE_CHANGE_STATUSES,
  type Address, type ChecklistItemState, type ChecklistTemplateItem, type EmergencyContact, type EventValues,
} from "../../../lib/hr";
import { nowIso, timestamps } from "../columns";
import { users } from "./auth";
import { files } from "./system";

export const departments = sqliteTable("departments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  code: text("code").unique(),
  headEmployeeId: integer("head_employee_id").references((): AnySQLiteColumn => employees.id, { onDelete: "set null" }),
  parentId: integer("parent_id").references((): AnySQLiteColumn => departments.id, { onDelete: "set null" }),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

export const designations = sqliteTable("designations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  level: integer("level"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

export const employees = sqliteTable(
  "employees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .unique()
      .references(() => users.id, { onDelete: "set null" }),
    employeeCode: text("employee_code").notNull().unique(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull().default(""),
    displayName: text("display_name").notNull(),
    workEmail: text("work_email").unique(),
    personalEmail: text("personal_email"),
    phone: text("phone"),
    dateOfBirth: text("date_of_birth"),
    gender: text("gender", { enum: GENDERS }),
    maritalStatus: text("marital_status", { enum: MARITAL_STATUSES }),
    address: text("address", { mode: "json" }).$type<Address | null>(),
    emergencyContact: text("emergency_contact", { mode: "json" }).$type<EmergencyContact | null>(),
    departmentId: integer("department_id").references((): AnySQLiteColumn => departments.id),
    designationId: integer("designation_id").references(() => designations.id),
    reportingManagerId: integer("reporting_manager_id").references((): AnySQLiteColumn => employees.id),
    employmentType: text("employment_type", { enum: EMPLOYMENT_TYPES }).notNull().default("full_time"),
    workLocation: text("work_location"),
    dateOfJoining: text("date_of_joining").notNull(),
    probationEndDate: text("probation_end_date"),
    confirmationDate: text("confirmation_date"),
    noticePeriodDays: integer("notice_period_days").notNull().default(30),
    status: text("status", { enum: EMPLOYEE_STATUSES }).notNull().default("active"),
    resignationDate: text("resignation_date"),
    lastWorkingDate: text("last_working_date"),
    exitReason: text("exit_reason"),
    bankName: text("bank_name"),
    /** AES-256-GCM (`encrypt()`); never sent to the client. */
    bankAccountEnc: text("bank_account_enc"),
    bankIfsc: text("bank_ifsc"),
    /** AES-256-GCM of the JSON `IdNumbers`; never sent to the client. */
    idNumbersEnc: text("id_numbers_enc"),
    photoFileId: integer("photo_file_id").references(() => files.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("employees_status_idx").on(t.status),
    index("employees_department_idx").on(t.departmentId),
    index("employees_manager_idx").on(t.reportingManagerId),
  ],
);

export const employeeDocuments = sqliteTable(
  "employee_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id),
    category: text("category", { enum: DOCUMENT_CATEGORIES }).notNull(),
    title: text("title").notNull(),
    uploadedBy: integer("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    index("employee_documents_employee_idx").on(t.employeeId),
    uniqueIndex("employee_documents_file_idx").on(t.fileId),
  ],
);

export const employeeEvents = sqliteTable(
  "employee_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    type: text("type", { enum: EMPLOYEE_EVENT_TYPES }).notNull(),
    effectiveDate: text("effective_date").notNull(),
    from: text("from", { mode: "json" }).$type<EventValues | null>(),
    to: text("to", { mode: "json" }).$type<EventValues | null>(),
    note: text("note"),
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("employee_events_employee_idx").on(t.employeeId, t.effectiveDate)],
);

export const checklistTemplates = sqliteTable("checklist_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: CHECKLIST_KINDS }).notNull(),
  name: text("name").notNull(),
  items: text("items", { mode: "json" }).$type<ChecklistTemplateItem[]>().notNull(),
  /** The template instantiated automatically for this kind. At most one per kind. */
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  ...timestamps(),
});

export const employeeChecklists = sqliteTable(
  "employee_checklists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    templateId: integer("template_id").references(() => checklistTemplates.id, { onDelete: "set null" }),
    kind: text("kind", { enum: CHECKLIST_KINDS }).notNull(),
    name: text("name").notNull(),
    items: text("items", { mode: "json" }).$type<ChecklistItemState[]>().notNull(),
    status: text("status", { enum: ["open", "completed", "cancelled"] }).notNull().default("open"),
    ...timestamps(),
  },
  (t) => [index("employee_checklists_employee_idx").on(t.employeeId)],
);

/** Requested bank block; sensitive values are stored encrypted, exactly like the `employees` columns. */
export interface ProfileChangeFields {
  bankName: string | null;
  bankAccountEnc: string | null;
  bankIfsc: string | null;
  idNumbersEnc: string | null;
}

export const profileChangeRequests = sqliteTable(
  "profile_change_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    fields: text("fields", { mode: "json" }).$type<ProfileChangeFields>().notNull(),
    reason: text("reason"),
    status: text("status", { enum: PROFILE_CHANGE_STATUSES }).notNull().default("pending"),
    requestedBy: integer("requested_by").references(() => users.id, { onDelete: "set null" }),
    approverId: integer("approver_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: text("decided_at"),
    note: text("note"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("profile_change_requests_employee_idx").on(t.employeeId, t.status)],
);

export type DepartmentRow = typeof departments.$inferSelect;
export type DesignationRow = typeof designations.$inferSelect;
export type EmployeeRow = typeof employees.$inferSelect;
export type EmployeeDocumentRow = typeof employeeDocuments.$inferSelect;
export type EmployeeEventRow = typeof employeeEvents.$inferSelect;
export type ChecklistTemplateRow = typeof checklistTemplates.$inferSelect;
export type EmployeeChecklistRow = typeof employeeChecklists.$inferSelect;
export type ProfileChangeRequestRow = typeof profileChangeRequests.$inferSelect;
```

`employees.shift_id` (spec §4.2) is added by Phase 3 together with the `shifts` table, as the roadmap's Phase 3 task 1 already plans.

- [ ] **Step 5: Export the schema** — `src/server/db/schema/index.ts`

```ts
export * from "./auth";
export * from "./system";
export * from "./core";
```

- [ ] **Step 6: Generate the migration**

Run: `npm run db:generate -- --name core_hr`
Expected: `src/server/db/migrations/0001_core_hr.sql` is created with `CREATE TABLE` statements for the eight tables, and `meta/_journal.json` gains entry `0001_core_hr`. Do not edit the SQL.

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run tests/integration/db`
Expected: PASS. Both the foundation schema tests and the 5 new core schema tests pass. `createTestDb()` applies all migrations.

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS.

```bash
git add src/server/db/schema src/server/db/migrations tests/helpers/employees.ts tests/integration/db/core-schema.test.ts
git commit -m "feat(db): add core HR schema and migration"
```

---
### Task 3: Org masters — departments and designations

**Files:**
- Create: `src/server/modules/org/service.ts`, `src/server/modules/org/queries.ts`
- Test: `tests/integration/org.test.ts`

**Interfaces:**
- Consumes: `departments`, `designations`, `employees` (Task 2); `DepartmentInput`, `DesignationInput` (Task 1); `SelectOption` (Task 1); `DomainError`.
- Produces:
  - `service.ts`: `createDepartment(db, input: DepartmentInput): DepartmentRow`, `updateDepartment(db, id, input): { before: DepartmentRow; after: DepartmentRow }`, `setDepartmentArchived(db, id, archived: boolean): DepartmentRow`, `createDesignation(db, input: DesignationInput): DesignationRow`, `updateDesignation(db, id, input): { before; after }`, `setDesignationArchived(db, id, archived): DesignationRow`.
  - Error codes: `DUPLICATE_NAME`, `DUPLICATE_CODE`, `DEPARTMENT_CYCLE`, `ARCHIVED`, `INVALID_HEAD`, `DEPARTMENT_IN_USE`, `DEPARTMENT_HAS_CHILDREN`, `DESIGNATION_IN_USE`, `NOT_FOUND`.
  - `queries.ts`: `DepartmentListItem`, `listDepartments(db)`, `DesignationListItem`, `listDesignations(db)`, `departmentOptions(db): SelectOption[]`, `designationOptions(db): SelectOption[]` (the last two exclude archived rows).

- [ ] **Step 1: Write the failing tests** — `tests/integration/org.test.ts`

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { employees } from "@/server/db/schema";
import { departmentOptions, designationOptions, listDepartments, listDesignations } from "@/server/modules/org/queries";
import {
  createDepartment, createDesignation, setDepartmentArchived, setDesignationArchived, updateDepartment, updateDesignation,
} from "@/server/modules/org/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError } from "../helpers/fixtures";

type DeptExtra = Partial<{ code: string | null; parentId: number | null; headEmployeeId: number | null }>;
const dept = (name: string, extra: DeptExtra = {}) => ({ name, code: null, parentId: null, headEmployeeId: null, ...extra });

let db: DB;
beforeEach(() => {
  db = createTestDb();
});

describe("departments", () => {
  it("creates departments with unique names (any case) and codes", () => {
    expect(createDepartment(db, dept("Engineering", { code: "ENG" }))).toMatchObject({ name: "Engineering", code: "ENG", archived: false });
    expectDomainError(() => createDepartment(db, dept("engineering")), "DUPLICATE_NAME");
    expectDomainError(() => createDepartment(db, dept("Platform", { code: "ENG" })), "DUPLICATE_CODE");
  });

  it("refuses parent loops, including a department under itself", () => {
    const eng = createDepartment(db, dept("Engineering"));
    const platform = createDepartment(db, dept("Platform", { parentId: eng.id }));
    expectDomainError(() => updateDepartment(db, eng.id, dept("Engineering", { parentId: platform.id })), "DEPARTMENT_CYCLE");
    expectDomainError(() => updateDepartment(db, eng.id, dept("Engineering", { parentId: eng.id })), "DEPARTMENT_CYCLE");
    expect(updateDepartment(db, platform.id, dept("Platform Eng", { parentId: eng.id })).after.name).toBe("Platform Eng");
  });

  it("requires an active parent and a current employee as head", () => {
    const old = createDepartment(db, dept("Old"));
    setDepartmentArchived(db, old.id, true);
    expectDomainError(() => createDepartment(db, dept("New", { parentId: old.id })), "ARCHIVED");
    const leaver = insertEmployee(db, { status: "exited" });
    expectDomainError(() => createDepartment(db, dept("Sales", { headEmployeeId: leaver.id })), "INVALID_HEAD");
    const head = insertEmployee(db);
    expect(createDepartment(db, dept("Sales", { headEmployeeId: head.id })).headEmployeeId).toBe(head.id);
  });

  it("archives only departments without current employees or active sub-departments", () => {
    const eng = createDepartment(db, dept("Engineering"));
    const member = insertEmployee(db, { departmentId: eng.id });
    expectDomainError(() => setDepartmentArchived(db, eng.id, true), "DEPARTMENT_IN_USE");
    db.update(employees).set({ status: "exited" }).where(eq(employees.id, member.id)).run();
    expect(setDepartmentArchived(db, eng.id, true).archived).toBe(true);
    expect(setDepartmentArchived(db, eng.id, false).archived).toBe(false);

    const parent = createDepartment(db, dept("Parent"));
    createDepartment(db, dept("Child", { parentId: parent.id }));
    expectDomainError(() => setDepartmentArchived(db, parent.id, true), "DEPARTMENT_HAS_CHILDREN");
  });

  it("lists departments with parent, head and current head-count; options skip archived ones", () => {
    const head = insertEmployee(db, { firstName: "Asha", lastName: "Rao", displayName: "Asha Rao" });
    const eng = createDepartment(db, dept("Engineering", { headEmployeeId: head.id }));
    createDepartment(db, dept("Platform", { parentId: eng.id }));
    const old = createDepartment(db, dept("Old"));
    setDepartmentArchived(db, old.id, true);
    insertEmployee(db, { departmentId: eng.id });
    insertEmployee(db, { departmentId: eng.id, status: "exited" });

    const rows = listDepartments(db);
    expect(rows.find((r) => r.name === "Engineering")).toMatchObject({ headName: "Asha Rao", employeeCount: 1, parentName: null });
    expect(rows.find((r) => r.name === "Platform")).toMatchObject({ parentName: "Engineering", employeeCount: 0 });
    expect(departmentOptions(db).map((o) => o.label)).toEqual(["Engineering", "Platform"]);
  });
});

describe("designations", () => {
  it("creates and renames designations with unique names", () => {
    const consultant = createDesignation(db, { name: "Consultant", level: 2 });
    createDesignation(db, { name: "Manager", level: 4 });
    expectDomainError(() => createDesignation(db, { name: "consultant", level: null }), "DUPLICATE_NAME");
    expectDomainError(() => updateDesignation(db, consultant.id, { name: "Manager", level: 2 }), "DUPLICATE_NAME");
    expect(updateDesignation(db, consultant.id, { name: "Senior Consultant", level: 3 }).after).toMatchObject({ name: "Senior Consultant", level: 3 });
  });

  it("refuses to archive a designation current employees hold, and hides archived ones from options", () => {
    const consultant = createDesignation(db, { name: "Consultant", level: null });
    const analyst = createDesignation(db, { name: "Analyst", level: null });
    insertEmployee(db, { designationId: consultant.id });
    expectDomainError(() => setDesignationArchived(db, consultant.id, true), "DESIGNATION_IN_USE");
    setDesignationArchived(db, analyst.id, true);
    expect(designationOptions(db).map((o) => o.label)).toEqual(["Consultant"]);
    expect(listDesignations(db).find((d) => d.name === "Consultant")?.employeeCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/org.test.ts`
Expected: FAIL — `Cannot find package '@/server/modules/org/queries'`.

- [ ] **Step 3: Implement `src/server/modules/org/service.ts`**

```ts
import { and, count, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { DepartmentInput, DesignationInput } from "@/lib/validation/org";
import type { DbLike } from "@/server/db/client";
import { departments, designations, employees, type DepartmentRow, type DesignationRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";

function currentEmployeeCount(db: DbLike, where: SQL): number {
  return (
    db
      .select({ n: count() })
      .from(employees)
      .where(and(where, inArray(employees.status, ["active", "on_notice"])))
      .get()?.n ?? 0
  );
}

function requireDepartment(db: DbLike, id: number): DepartmentRow {
  const row = db.select().from(departments).where(eq(departments.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Department not found.");
  return row;
}

function assertDepartmentUnique(db: DbLike, input: DepartmentInput, exceptId: number | null): void {
  const others = exceptId === null ? undefined : ne(departments.id, exceptId);
  const nameClash = db
    .select({ id: departments.id })
    .from(departments)
    .where(and(sql`lower(${departments.name}) = ${input.name.toLowerCase()}`, others))
    .get();
  if (nameClash) throw new DomainError("DUPLICATE_NAME", "A department with this name already exists.", { name: ["Already exists"] });
  if (input.code) {
    const codeClash = db.select({ id: departments.id }).from(departments).where(and(eq(departments.code, input.code), others)).get();
    if (codeClash) throw new DomainError("DUPLICATE_CODE", "This department code is already used.", { code: ["Already used"] });
  }
}

/** The parent must be active and must not be the department itself or one of its descendants. */
function assertParent(db: DbLike, id: number | null, parentId: number | null): void {
  if (parentId === null) return;
  const parent = db.select().from(departments).where(eq(departments.id, parentId)).get();
  if (!parent) throw new DomainError("NOT_FOUND", "Parent department not found.", { parentId: ["Not found"] });
  if (parent.archived) throw new DomainError("ARCHIVED", "Choose an active parent department.", { parentId: ["Archived"] });
  if (id === null) return;
  const seen = new Set<number>();
  let current: number | null = parentId;
  while (current !== null && !seen.has(current)) {
    if (current === id) {
      throw new DomainError("DEPARTMENT_CYCLE", "A department can't sit under itself or one of its sub-departments.", {
        parentId: ["Creates a loop"],
      });
    }
    seen.add(current);
    current = db.select({ parentId: departments.parentId }).from(departments).where(eq(departments.id, current)).get()?.parentId ?? null;
  }
}

function assertHead(db: DbLike, headEmployeeId: number | null): void {
  if (headEmployeeId === null) return;
  const head = db.select({ status: employees.status }).from(employees).where(eq(employees.id, headEmployeeId)).get();
  if (!head || head.status === "exited") {
    throw new DomainError("INVALID_HEAD", "Choose a current employee as department head.", { headEmployeeId: ["Not a current employee"] });
  }
}

export function createDepartment(db: DbLike, input: DepartmentInput): DepartmentRow {
  assertDepartmentUnique(db, input, null);
  assertParent(db, null, input.parentId);
  assertHead(db, input.headEmployeeId);
  return db.insert(departments).values(input).returning().get();
}

export function updateDepartment(db: DbLike, id: number, input: DepartmentInput): { before: DepartmentRow; after: DepartmentRow } {
  const before = requireDepartment(db, id);
  assertDepartmentUnique(db, input, id);
  if (input.parentId !== before.parentId || input.parentId === id) assertParent(db, id, input.parentId);
  if (input.headEmployeeId !== before.headEmployeeId) assertHead(db, input.headEmployeeId);
  const after = db.update(departments).set(input).where(eq(departments.id, id)).returning().get()!;
  return { before, after };
}

export function setDepartmentArchived(db: DbLike, id: number, archived: boolean): DepartmentRow {
  requireDepartment(db, id);
  if (archived) {
    const members = currentEmployeeCount(db, eq(employees.departmentId, id));
    if (members > 0) {
      throw new DomainError("DEPARTMENT_IN_USE", `Move this department's ${members} current employee(s) to another department first.`);
    }
    const children = db
      .select({ n: count() })
      .from(departments)
      .where(and(eq(departments.parentId, id), eq(departments.archived, false)))
      .get()?.n ?? 0;
    if (children > 0) throw new DomainError("DEPARTMENT_HAS_CHILDREN", "Archive or move its sub-departments first.");
  }
  return db.update(departments).set({ archived }).where(eq(departments.id, id)).returning().get()!;
}

function requireDesignation(db: DbLike, id: number): DesignationRow {
  const row = db.select().from(designations).where(eq(designations.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Designation not found.");
  return row;
}

function assertDesignationUnique(db: DbLike, name: string, exceptId: number | null): void {
  const clash = db
    .select({ id: designations.id })
    .from(designations)
    .where(and(sql`lower(${designations.name}) = ${name.toLowerCase()}`, exceptId === null ? undefined : ne(designations.id, exceptId)))
    .get();
  if (clash) throw new DomainError("DUPLICATE_NAME", "A designation with this name already exists.", { name: ["Already exists"] });
}

export function createDesignation(db: DbLike, input: DesignationInput): DesignationRow {
  assertDesignationUnique(db, input.name, null);
  return db.insert(designations).values(input).returning().get();
}

export function updateDesignation(db: DbLike, id: number, input: DesignationInput): { before: DesignationRow; after: DesignationRow } {
  const before = requireDesignation(db, id);
  assertDesignationUnique(db, input.name, id);
  const after = db.update(designations).set(input).where(eq(designations.id, id)).returning().get()!;
  return { before, after };
}

export function setDesignationArchived(db: DbLike, id: number, archived: boolean): DesignationRow {
  requireDesignation(db, id);
  if (archived) {
    const holders = currentEmployeeCount(db, eq(employees.designationId, id));
    if (holders > 0) {
      throw new DomainError("DESIGNATION_IN_USE", `${holders} current employee(s) hold this designation. Change theirs first.`);
    }
  }
  return db.update(designations).set({ archived }).where(eq(designations.id, id)).returning().get()!;
}
```

- [ ] **Step 4: Implement `src/server/modules/org/queries.ts`**

```ts
import { asc, count, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { SelectOption } from "@/lib/hr";
import type { DbLike } from "@/server/db/client";
import { departments, designations, employees } from "@/server/db/schema";

export interface DepartmentListItem {
  id: number;
  name: string;
  code: string | null;
  parentId: number | null;
  parentName: string | null;
  headEmployeeId: number | null;
  headName: string | null;
  archived: boolean;
  employeeCount: number;
}

export interface DesignationListItem {
  id: number;
  name: string;
  level: number | null;
  archived: boolean;
  employeeCount: number;
}

function currentCounts(db: DbLike, column: typeof employees.departmentId | typeof employees.designationId): Map<number | null, number> {
  const rows = db
    .select({ key: column, n: count() })
    .from(employees)
    .where(inArray(employees.status, ["active", "on_notice"]))
    .groupBy(column)
    .all();
  return new Map(rows.map((r) => [r.key, r.n]));
}

export function listDepartments(db: DbLike): DepartmentListItem[] {
  const parent = alias(departments, "parent");
  const counts = currentCounts(db, employees.departmentId);
  return db
    .select({
      id: departments.id,
      name: departments.name,
      code: departments.code,
      parentId: departments.parentId,
      parentName: parent.name,
      headEmployeeId: departments.headEmployeeId,
      headName: employees.displayName,
      archived: departments.archived,
    })
    .from(departments)
    .leftJoin(parent, eq(parent.id, departments.parentId))
    .leftJoin(employees, eq(employees.id, departments.headEmployeeId))
    .orderBy(asc(departments.name))
    .all()
    .map((row) => ({ ...row, employeeCount: counts.get(row.id) ?? 0 }));
}

export function listDesignations(db: DbLike): DesignationListItem[] {
  const counts = currentCounts(db, employees.designationId);
  return db
    .select({ id: designations.id, name: designations.name, level: designations.level, archived: designations.archived })
    .from(designations)
    .orderBy(asc(designations.name))
    .all()
    .map((row) => ({ ...row, employeeCount: counts.get(row.id) ?? 0 }));
}

export function departmentOptions(db: DbLike): SelectOption[] {
  return db
    .select({ id: departments.id, label: departments.name })
    .from(departments)
    .where(eq(departments.archived, false))
    .orderBy(asc(departments.name))
    .all();
}

export function designationOptions(db: DbLike): SelectOption[] {
  return db
    .select({ id: designations.id, label: designations.name })
    .from(designations)
    .where(eq(designations.archived, false))
    .orderBy(asc(designations.name))
    .all();
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/integration/org.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/org tests/integration/org.test.ts
git commit -m "feat(org): add departments and designations services"
```

---

### Task 4: Employee codes and sensitive-field helpers

**Files:**
- Create: `src/server/modules/employees/code.ts`, `src/server/modules/employees/sensitive.ts`
- Test: `tests/integration/employee-code.test.ts`, `tests/unit/server/sensitive.test.ts`

**Interfaces:**
- Consumes: `employees` (Task 2); `getSetting(db, "employee")`; `encrypt`/`decrypt`/`mask` (`src/server/lib/crypto.ts`); `IdNumbers` (Task 1); `BankInput` (Task 1).
- Produces:
  - `nextEmployeeCode(db): string`.
  - `BankSource` (`{ bankName, bankAccountEnc, bankIfsc, idNumbersEnc }`) and `BankView` (`{ bankName, bankAccount, bankIfsc, pan, aadhaar, passport, masked }`).
  - `sealBank(input: BankInput): BankSource`, `openBank(source: BankSource): BankInput`, `bankView(source: BankSource, reveal: boolean): BankView`, `openIdNumbers(enc: string | null): IdNumbers`.

- [ ] **Step 1: Write the failing tests**

`tests/integration/employee-code.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { nextEmployeeCode } from "@/server/modules/employees/code";
import { patchSetting } from "@/server/modules/settings/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";

describe("nextEmployeeCode", () => {
  let db: DB;
  beforeEach(() => {
    db = createTestDb();
  });

  it("starts at 1 with the default prefix and width", () => {
    expect(nextEmployeeCode(db)).toBe("PV0001");
  });

  it("continues after the highest code with the same prefix, ignoring look-alikes", () => {
    for (const code of ["PV0007", "PV0012", "PVX0099", "EMP0500", "PV12A"]) insertEmployee(db, { employeeCode: code });
    expect(nextEmployeeCode(db)).toBe("PV0013");
  });

  it("follows the configured prefix and width", () => {
    patchSetting(db, "employee", { codePrefix: "EMP", codeDigits: 3 }, null);
    insertEmployee(db, { employeeCode: "PV0042" });
    expect(nextEmployeeCode(db)).toBe("EMP001");
  });

  it("grows past the configured width instead of wrapping", () => {
    insertEmployee(db, { employeeCode: "PV9999" });
    expect(nextEmployeeCode(db)).toBe("PV10000");
  });
});
```

`tests/unit/server/sensitive.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bankView, openBank, openIdNumbers, sealBank } from "@/server/modules/employees/sensitive";

const input = {
  bankName: "HDFC Bank", bankAccount: "123456789012", bankIfsc: "HDFC0001234",
  pan: "ABCDE1234F", aadhaar: "123412341234", passport: null,
};

describe("sensitive bank fields", () => {
  it("encrypts the account and ID numbers and restores them", () => {
    const sealed = sealBank(input);
    expect(sealed.bankAccountEnc).toMatch(/^v1:/);
    expect(sealed.bankAccountEnc).not.toContain("123456789012");
    expect(sealed.idNumbersEnc).not.toContain("ABCDE1234F");
    expect(sealed).toMatchObject({ bankName: "HDFC Bank", bankIfsc: "HDFC0001234" });
    expect(openBank(sealed)).toEqual(input);
  });

  it("stores nothing when there are no values to protect", () => {
    const sealed = sealBank({ ...input, bankAccount: null, pan: null, aadhaar: null });
    expect(sealed.bankAccountEnc).toBeNull();
    expect(sealed.idNumbersEnc).toBeNull();
    expect(openIdNumbers(null)).toEqual({ pan: null, aadhaar: null, passport: null });
  });

  it("masks all but the last four characters unless revealed", () => {
    const sealed = sealBank(input);
    expect(bankView(sealed, false)).toEqual({
      bankName: "HDFC Bank", bankAccount: "XXXX9012", bankIfsc: "HDFC0001234",
      pan: "XXXX234F", aadhaar: "XXXX1234", passport: null, masked: true,
    });
    expect(bankView(sealed, true)).toEqual({ ...input, masked: false });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/employee-code.test.ts tests/unit/server/sensitive.test.ts`
Expected: FAIL — both modules are missing.

- [ ] **Step 3: Implement `src/server/modules/employees/code.ts`**

```ts
import { like } from "drizzle-orm";
import type { DbLike } from "@/server/db/client";
import { employees } from "@/server/db/schema";
import { getSetting } from "@/server/modules/settings/service";

/** Next code for the configured prefix: highest existing `<prefix><digits>` + 1, zero-padded (spec §5.1). */
export function nextEmployeeCode(db: DbLike): string {
  const { codePrefix, codeDigits } = getSetting(db, "employee");
  // codePrefix is validated as 1–5 uppercase letters, so it is safe inside a RegExp.
  const pattern = new RegExp(`^${codePrefix}(\\d+)$`);
  let max = 0;
  const rows = db
    .select({ code: employees.employeeCode })
    .from(employees)
    .where(like(employees.employeeCode, `${codePrefix}%`))
    .all();
  for (const { code } of rows) {
    const match = pattern.exec(code);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${codePrefix}${String(max + 1).padStart(codeDigits, "0")}`;
}
```

- [ ] **Step 4: Implement `src/server/modules/employees/sensitive.ts`**

```ts
import type { IdNumbers } from "@/lib/hr";
import type { BankInput } from "@/lib/validation/employees";
import { decrypt, encrypt, mask } from "@/server/lib/crypto";

/** How the bank block is stored on `employees` (and in change requests). */
export interface BankSource {
  bankName: string | null;
  bankAccountEnc: string | null;
  bankIfsc: string | null;
  idNumbersEnc: string | null;
}

/** The bank block as shown to a person: masked (`XXXX1234`) unless revealed. */
export interface BankView {
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  pan: string | null;
  aadhaar: string | null;
  passport: string | null;
  masked: boolean;
}

export function openIdNumbers(enc: string | null): IdNumbers {
  if (!enc) return { pan: null, aadhaar: null, passport: null };
  const parsed = JSON.parse(decrypt(enc)) as Partial<IdNumbers>;
  return { pan: parsed.pan ?? null, aadhaar: parsed.aadhaar ?? null, passport: parsed.passport ?? null };
}

export function sealBank(input: BankInput): BankSource {
  const ids: IdNumbers = { pan: input.pan, aadhaar: input.aadhaar, passport: input.passport };
  return {
    bankName: input.bankName,
    bankAccountEnc: input.bankAccount ? encrypt(input.bankAccount) : null,
    bankIfsc: input.bankIfsc,
    idNumbersEnc: ids.pan || ids.aadhaar || ids.passport ? encrypt(JSON.stringify(ids)) : null,
  };
}

export function openBank(source: BankSource): BankInput {
  return {
    bankName: source.bankName,
    bankAccount: source.bankAccountEnc ? decrypt(source.bankAccountEnc) : null,
    bankIfsc: source.bankIfsc,
    ...openIdNumbers(source.idNumbersEnc),
  };
}

const maskOrNull = (value: string | null) => (value ? mask(value) : null);

/** Pass `reveal: true` only when the viewer holds `employee.sensitive.view` (spec §3.4). */
export function bankView(source: BankSource, reveal: boolean): BankView {
  const plain = openBank(source);
  if (reveal) return { ...plain, masked: false };
  return {
    bankName: plain.bankName,
    bankAccount: maskOrNull(plain.bankAccount),
    bankIfsc: plain.bankIfsc,
    pan: maskOrNull(plain.pan),
    aadhaar: maskOrNull(plain.aadhaar),
    passport: maskOrNull(plain.passport),
    masked: true,
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/integration/employee-code.test.ts tests/unit/server/sensitive.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/employees/code.ts src/server/modules/employees/sensitive.ts tests/integration/employee-code.test.ts tests/unit/server/sensitive.test.ts
git commit -m "feat(employees): add employee code generator and sensitive-field helpers"
```

---

### Task 5: Reporting scope and session employee context

**Files:**
- Create: `src/server/modules/employees/scope.ts`
- Modify: `src/lib/auth/types.ts`, `src/lib/auth/permissions.ts`, `src/server/modules/users/service.ts`, `tests/integration/users.test.ts:224-227`
- Test: `tests/integration/scope.test.ts`, `tests/unit/lib/permissions.test.ts` (append)

**Interfaces:**
- Consumes: `employees` (Task 2); `can`, `permissionsForRoles`, `ROLE_PERMISSIONS`, `ROLES`; `users`, `userRoles`.
- Produces:
  - `SessionUser` gains `employeeId: number | null` and `hasReports: boolean`.
  - `TEAM_APPROVAL_PERMISSIONS`, `permissionsForUser(roles, { hasReports }): Permission[]`.
  - `scope.ts`: `ScopeUser = Pick<SessionUser, "permissions" | "employeeId">`, `getReportingTree(db, managerEmployeeId): number[]` (every employee below, cycle-safe, sorted by id, never the manager), `getDirectReportIds(db, managerEmployeeId): number[]` (current employees only), `employeeContextForUser(db, userId): { employeeId: number | null; hasReports: boolean }`.
  - `isInScope(db, user, employeeId): boolean`: true for `employee.view` holders, or when the employee is below `user.employeeId`; self is not in scope.
  - `canViewEmployee(db, user, employeeId): boolean` (self or in scope), `viewableEmployeeIds(db, user): "all" | number[]`.
  - `activeUserIdsWithPermission(db, permission): number[]` in the users service.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/lib/permissions.test.ts` (add `permissionsForUser` to the import list):

```ts
describe("permissionsForUser", () => {
  it("gives anyone with a direct report team approvals, but not team reports", () => {
    const withReports = { permissions: permissionsForUser(["employee"], { hasReports: true }) };
    expect(can(withReports, "leave.approve")).toBe(true);
    expect(can(withReports, "timesheet.approve")).toBe(true);
    expect(can(withReports, "report.leave")).toBe(false);
    expect(can({ permissions: permissionsForUser(["employee"], { hasReports: false }) }, "leave.approve")).toBe(false);
  });

  it("leaves role permissions unchanged otherwise", () => {
    expect(permissionsForUser(["hr_admin"], { hasReports: false })).toEqual(permissionsForRoles(["hr_admin"]));
  });
});
```

`tests/integration/scope.test.ts`:

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { permissionsForRoles, type Role } from "@/lib/auth/permissions";
import type { DB } from "@/server/db/client";
import { employees, users, type EmployeeRow } from "@/server/db/schema";
import {
  canViewEmployee, employeeContextForUser, getReportingTree, isInScope, viewableEmployeeIds,
} from "@/server/modules/employees/scope";
import { activeUserIdsWithPermission, loadSessionUser } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser } from "../helpers/fixtures";

// ceo ← asha ← ravi ← kiran, and ceo ← meera (asha's peer)
let db: DB;
let ceo: EmployeeRow;
let asha: EmployeeRow;
let ravi: EmployeeRow;
let kiran: EmployeeRow;
let meera: EmployeeRow;

const viewer = (employee: EmployeeRow | null, roles: Role[] = ["employee"]) => ({
  permissions: permissionsForRoles(roles),
  employeeId: employee?.id ?? null,
});

beforeEach(() => {
  db = createTestDb();
  ceo = insertEmployee(db);
  asha = insertEmployee(db, { reportingManagerId: ceo.id });
  ravi = insertEmployee(db, { reportingManagerId: asha.id });
  kiran = insertEmployee(db, { reportingManagerId: ravi.id });
  meera = insertEmployee(db, { reportingManagerId: ceo.id });
});

describe("reporting tree", () => {
  it("returns everyone below a manager, direct and indirect", () => {
    expect(getReportingTree(db, ceo.id)).toEqual([asha.id, ravi.id, kiran.id, meera.id]);
    expect(getReportingTree(db, asha.id)).toEqual([ravi.id, kiran.id]);
    expect(getReportingTree(db, kiran.id)).toEqual([]);
  });

  it("terminates on a stored reporting loop and never includes the manager", () => {
    db.update(employees).set({ reportingManagerId: kiran.id }).where(eq(employees.id, asha.id)).run();
    expect(getReportingTree(db, asha.id)).toEqual([ravi.id, kiran.id]);
  });
});

describe("session employee context", () => {
  it("links the user to their employee and detects current direct reports", () => {
    const ashaUser = insertUser(db);
    const kiranUser = insertUser(db);
    const loner = insertUser(db);
    db.update(employees).set({ userId: ashaUser.id }).where(eq(employees.id, asha.id)).run();
    db.update(employees).set({ userId: kiranUser.id }).where(eq(employees.id, kiran.id)).run();

    expect(employeeContextForUser(db, ashaUser.id)).toEqual({ employeeId: asha.id, hasReports: true });
    expect(employeeContextForUser(db, kiranUser.id)).toEqual({ employeeId: kiran.id, hasReports: false });
    expect(employeeContextForUser(db, loner.id)).toEqual({ employeeId: null, hasReports: false });

    db.update(employees).set({ status: "exited" }).where(eq(employees.id, ravi.id)).run();
    expect(employeeContextForUser(db, ashaUser.id).hasReports).toBe(false);
  });

  it("loads team approval permissions into the session of anyone with reports", () => {
    const ashaUser = insertUser(db, { roles: ["employee"] });
    db.update(employees).set({ userId: ashaUser.id }).where(eq(employees.id, asha.id)).run();
    const session = loadSessionUser(db, ashaUser.id, ashaUser.sessionVersion)!;
    expect(session).toMatchObject({ employeeId: asha.id, hasReports: true });
    expect(session.permissions).toContain("leave.approve");
  });
});

describe("scope checks", () => {
  it("lets managers act on their tree only, and never on themselves", () => {
    expect(isInScope(db, viewer(asha), kiran.id)).toBe(true);
    expect(isInScope(db, viewer(asha), meera.id)).toBe(false);
    expect(isInScope(db, viewer(asha), ceo.id)).toBe(false);
    expect(isInScope(db, viewer(asha), asha.id)).toBe(false);
    expect(isInScope(db, viewer(null), kiran.id)).toBe(false);
  });

  it("gives org-wide viewers everyone", () => {
    expect(isInScope(db, viewer(null, ["hr_admin"]), kiran.id)).toBe(true);
    expect(viewableEmployeeIds(db, viewer(null, ["payroll_admin"]))).toBe("all");
  });

  it("lets people view themselves plus their tree", () => {
    expect(canViewEmployee(db, viewer(kiran), kiran.id)).toBe(true);
    expect(canViewEmployee(db, viewer(kiran), ravi.id)).toBe(false);
    expect(viewableEmployeeIds(db, viewer(ravi))).toEqual([ravi.id, kiran.id]);
    expect(viewableEmployeeIds(db, viewer(null))).toEqual([]);
  });
});

describe("activeUserIdsWithPermission", () => {
  it("returns active users whose roles grant the permission", () => {
    const hr = insertUser(db, { roles: ["hr_admin"] });
    const root = insertUser(db, { roles: ["super_admin"] });
    insertUser(db, { roles: ["employee"] });
    const disabledHr = insertUser(db, { roles: ["hr_admin"] });
    db.update(users).set({ status: "disabled" }).where(eq(users.id, disabledHr.id)).run();
    expect(activeUserIdsWithPermission(db, "employee.update")).toEqual([hr.id, root.id]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/scope.test.ts tests/unit/lib/permissions.test.ts`
Expected: FAIL — `@/server/modules/employees/scope` is missing and `permissionsForUser` is not exported.

- [ ] **Step 3: Extend `SessionUser`** — replace `src/lib/auth/types.ts`

```ts
import type { Permission, Role } from "./permissions";

/** The authenticated user as resolved from the database on each request. */
export interface SessionUser {
  id: number;
  email: string;
  name: string;
  roles: Role[];
  permissions: Permission[];
  mustChangePassword: boolean;
  /** The linked employee record, if any. */
  employeeId: number | null;
  /** True when at least one current employee reports directly to this user's employee record. */
  hasReports: boolean;
}
```

- [ ] **Step 4: Add team approval permissions** — append to `src/lib/auth/permissions.ts`

```ts
/**
 * Approval rights that anyone with at least one direct report receives for their reporting tree,
 * even without the manager role (spec §3.2). Team reports stay with the manager role.
 */
export const TEAM_APPROVAL_PERMISSIONS: readonly Permission[] = [
  "leave.approve",
  "compoff.approve",
  "regularization.approve",
  "timesheet.approve",
  "claim.approve",
];

export function permissionsForUser(roles: readonly Role[], { hasReports }: { hasReports: boolean }): Permission[] {
  const base = permissionsForRoles(roles);
  if (!hasReports) return base;
  return [...new Set([...base, ...TEAM_APPROVAL_PERMISSIONS])].sort();
}
```

- [ ] **Step 5: Implement `src/server/modules/employees/scope.ts`**

```ts
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DbLike } from "@/server/db/client";
import { employees } from "@/server/db/schema";

export type ScopeUser = Pick<SessionUser, "permissions" | "employeeId">;

/**
 * Every employee below `managerEmployeeId`, direct and indirect, sorted by id.
 * `union` (not `union all`) makes the recursion stop even if stored data contains a reporting loop.
 */
export function getReportingTree(db: DbLike, managerEmployeeId: number): number[] {
  return db
    .all<{ id: number }>(
      sql`with recursive tree(id) as (
            select id from employees where reporting_manager_id = ${managerEmployeeId}
            union
            select e.id from employees e join tree on e.reporting_manager_id = tree.id
          )
          select id from tree where id <> ${managerEmployeeId} order by id`,
    )
    .map((row) => row.id);
}

/** Current (active or on-notice) direct reports. */
export function getDirectReportIds(db: DbLike, managerEmployeeId: number): number[] {
  return db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.reportingManagerId, managerEmployeeId), inArray(employees.status, ["active", "on_notice"])))
    .orderBy(asc(employees.id))
    .all()
    .map((row) => row.id);
}

export function employeeContextForUser(db: DbLike, userId: number): { employeeId: number | null; hasReports: boolean } {
  const employee = db.select({ id: employees.id }).from(employees).where(eq(employees.userId, userId)).get();
  if (!employee) return { employeeId: null, hasReports: false };
  return { employeeId: employee.id, hasReports: getDirectReportIds(db, employee.id).length > 0 };
}

/**
 * True when `user` may act on `employeeId` as an org-wide viewer (`employee.view`) or as a manager above them.
 * Self is deliberately not "in scope" so approvals can never be self-approvals; use `canViewEmployee` for viewing.
 */
export function isInScope(db: DbLike, user: ScopeUser, employeeId: number): boolean {
  if (can(user, "employee.view")) return true;
  if (user.employeeId === null || user.employeeId === employeeId) return false;
  return getReportingTree(db, user.employeeId).includes(employeeId);
}

export function canViewEmployee(db: DbLike, user: ScopeUser, employeeId: number): boolean {
  return user.employeeId === employeeId || isInScope(db, user, employeeId);
}

/** Employee ids whose profile `user` may open: everyone for org-wide viewers, else self plus reporting tree. */
export function viewableEmployeeIds(db: DbLike, user: ScopeUser): "all" | number[] {
  if (can(user, "employee.view")) return "all";
  if (user.employeeId === null) return [];
  return [user.employeeId, ...getReportingTree(db, user.employeeId)];
}
```

- [ ] **Step 6: Load the employee context into sessions** — `src/server/modules/users/service.ts`

Change the import block at the top of the file to:

```ts
import bcrypt from "bcryptjs";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { passwordProblems, type PasswordPolicy } from "@/lib/auth/password-policy";
import {
  can, isPrivilegedRole, permissionsForUser, ROLE_PERMISSIONS, ROLES, type Permission, type Role,
} from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DbLike } from "@/server/db/client";
import { passwordResetTokens, userRoles, users, type UserRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { randomToken, sha256Hex } from "@/server/lib/crypto";
import { employeeContextForUser } from "@/server/modules/employees/scope";
```

Replace `loadSessionUser` with:

```ts
/** Resolves the session user, or null when the user is gone, disabled, or the session was revoked. */
export function loadSessionUser(db: DbLike, userId: number, sessionVersion: number | undefined): SessionUser | null {
  const user = getUserById(db, userId);
  if (!user || user.status !== "active" || user.sessionVersion !== sessionVersion) return null;
  const roles = getUserRoles(db, userId);
  const { employeeId, hasReports } = employeeContextForUser(db, userId);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles,
    permissions: permissionsForUser(roles, { hasReports }),
    mustChangePassword: user.mustChangePassword,
    employeeId,
    hasReports,
  };
}
```

Append:

```ts
/** Active users whose roles grant `permission`, e.g. the HR recipients of `employee.update` notifications. */
export function activeUserIdsWithPermission(db: DbLike, permission: Permission): number[] {
  const roles = ROLES.filter((role) => ROLE_PERMISSIONS[role].includes(permission));
  if (roles.length === 0) return [];
  const ids = db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(users.status, "active"), inArray(userRoles.role, roles)))
    .all()
    .map((row) => row.id);
  return [...new Set(ids)].sort((a, b) => a - b);
}
```

`employees/scope.ts` imports only the schema and `lib`, so this new import does not create a cycle with `employees/service.ts` (Task 7), which imports the users service.

- [ ] **Step 7: Update the hand-built session in `tests/integration/users.test.ts`**

The `phantom` literal near line 224 must satisfy the extended type:

```ts
    const phantom: SessionUser = {
      id: 999, email: "p@pvcon.in", name: "P", roles: ["super_admin"],
      permissions: permissionsForRoles(["super_admin"]), mustChangePassword: false, employeeId: null, hasReports: false,
    };
```

- [ ] **Step 8: Run to verify pass**

Run: `npx vitest run tests/integration/scope.test.ts tests/unit/lib/permissions.test.ts && npm run typecheck && npm test`
Expected: PASS. The new scope tests (8) and permission tests (2) pass, typecheck is clean, and the whole suite stays green. Every existing session comes from `loadSessionUser`, so it gains `employeeId: null, hasReports: false`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth src/server/modules/employees/scope.ts src/server/modules/users/service.ts tests/integration/scope.test.ts tests/unit/lib/permissions.test.ts tests/integration/users.test.ts
git commit -m "feat(employees): add reporting-tree scope and session employee context"
```

---

### Task 6: Onboarding and offboarding checklists

**Files:**
- Create: `src/server/modules/employees/checklists.ts`
- Modify: `scripts/seed.ts`
- Test: `tests/integration/checklists.test.ts`

**Interfaces:**
- Consumes: `checklistTemplates`, `employeeChecklists` (Task 2); `ChecklistTemplateInput` (Task 1); `nowIso`.
- Produces:
  - `createChecklistTemplate(db, input): ChecklistTemplateRow`, `updateChecklistTemplate(db, id, input): { before; after }`, `setChecklistTemplateArchived(db, id, archived): ChecklistTemplateRow`, `listChecklistTemplates(db): ChecklistTemplateRow[]`.
  - `instantiateChecklist(db, employeeId, kind): EmployeeChecklistRow | null`, `listEmployeeChecklists(db, employeeId): EmployeeChecklistRow[]`, `getEmployeeChecklist(db, id)`.
  - `toggleChecklistItem(db, checklistId, index, done, actor: { id: number; name: string }): EmployeeChecklistRow`, `cancelOpenChecklists(db, employeeId, kind): number`, `seedDefaultChecklistTemplates(db): number`.
  - Error codes: `NOT_FOUND`, `ARCHIVED`, `CHECKLIST_CANCELLED`.

- [ ] **Step 1: Write the failing tests** — `tests/integration/checklists.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import {
  cancelOpenChecklists, createChecklistTemplate, instantiateChecklist, listChecklistTemplates, listEmployeeChecklists,
  seedDefaultChecklistTemplates, setChecklistTemplateArchived, toggleChecklistItem, updateChecklistTemplate,
} from "@/server/modules/employees/checklists";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError } from "../helpers/fixtures";

const actor = { id: 1, name: "Hari Rao" };
const interns = {
  kind: "onboarding" as const,
  name: "Interns",
  items: [{ label: "Assign a mentor", owner: "manager" as const }, { label: "Share the intern handbook", owner: "hr" as const }],
  isDefault: true,
};

let db: DB;
beforeEach(() => {
  db = createTestDb();
});

describe("checklist templates", () => {
  it("seeds one default onboarding and offboarding template, once", () => {
    expect(seedDefaultChecklistTemplates(db)).toBe(2);
    expect(seedDefaultChecklistTemplates(db)).toBe(0);
    expect(listChecklistTemplates(db).map((t) => [t.kind, t.isDefault])).toEqual([["offboarding", true], ["onboarding", true]]);
  });

  it("keeps a single default per kind", () => {
    seedDefaultChecklistTemplates(db);
    const custom = createChecklistTemplate(db, interns);
    const defaults = listChecklistTemplates(db).filter((t) => t.kind === "onboarding" && t.isDefault);
    expect(defaults.map((t) => t.id)).toEqual([custom.id]);
  });

  it("drops the default flag when archiving and refuses to make an archived template the default", () => {
    const template = createChecklistTemplate(db, interns);
    expect(setChecklistTemplateArchived(db, template.id, true)).toMatchObject({ archived: true, isDefault: false });
    expect(instantiateChecklist(db, insertEmployee(db).id, "onboarding")).toBeNull();
    expectDomainError(() => updateChecklistTemplate(db, template.id, interns), "ARCHIVED");
  });
});

describe("employee checklists", () => {
  it("copies the default template's items, all open", () => {
    createChecklistTemplate(db, interns);
    const employee = insertEmployee(db);
    const checklist = instantiateChecklist(db, employee.id, "onboarding")!;
    expect(checklist).toMatchObject({ employeeId: employee.id, kind: "onboarding", name: "Interns", status: "open" });
    expect(checklist.items).toEqual([
      { label: "Assign a mentor", owner: "manager", doneAt: null, doneBy: null, doneByName: null },
      { label: "Share the intern handbook", owner: "hr", doneAt: null, doneBy: null, doneByName: null },
    ]);
    expect(instantiateChecklist(db, employee.id, "offboarding")).toBeNull();
  });

  it("completes when every item is ticked and reopens when one is unticked", () => {
    createChecklistTemplate(db, interns);
    const checklist = instantiateChecklist(db, insertEmployee(db).id, "onboarding")!;
    const first = toggleChecklistItem(db, checklist.id, 0, true, actor);
    expect(first.status).toBe("open");
    expect(first.items[0]).toMatchObject({ doneBy: 1, doneByName: "Hari Rao" });
    expect(first.items[0]!.doneAt).not.toBeNull();
    expect(toggleChecklistItem(db, checklist.id, 1, true, actor).status).toBe("completed");
    const reopened = toggleChecklistItem(db, checklist.id, 0, false, actor);
    expect(reopened.status).toBe("open");
    expect(reopened.items[0]).toMatchObject({ doneAt: null, doneBy: null, doneByName: null });
  });

  it("rejects unknown items and cancelled checklists, and cancels only open ones of a kind", () => {
    createChecklistTemplate(db, interns);
    const employee = insertEmployee(db);
    const checklist = instantiateChecklist(db, employee.id, "onboarding")!;
    expectDomainError(() => toggleChecklistItem(db, checklist.id, 5, true, actor), "NOT_FOUND");
    expect(cancelOpenChecklists(db, employee.id, "offboarding")).toBe(0);
    expect(cancelOpenChecklists(db, employee.id, "onboarding")).toBe(1);
    expectDomainError(() => toggleChecklistItem(db, checklist.id, 0, true, actor), "CHECKLIST_CANCELLED");
    expect(listEmployeeChecklists(db, employee.id).map((c) => c.status)).toEqual(["cancelled"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/checklists.test.ts`
Expected: FAIL — `@/server/modules/employees/checklists` is missing.

- [ ] **Step 3: Implement `src/server/modules/employees/checklists.ts`**

```ts
import { and, asc, desc, eq } from "drizzle-orm";
import type { ChecklistItemState, ChecklistKind, ChecklistTemplateItem } from "@/lib/hr";
import type { ChecklistTemplateInput } from "@/lib/validation/org";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import {
  checklistTemplates, employeeChecklists, type ChecklistTemplateRow, type EmployeeChecklistRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";

const DEFAULT_TEMPLATES: { kind: ChecklistKind; name: string; items: ChecklistTemplateItem[] }[] = [
  {
    kind: "onboarding",
    name: "Standard onboarding",
    items: [
      { label: "Collect the signed offer letter", owner: "hr" },
      { label: "Collect ID and address proofs", owner: "employee" },
      { label: "Add bank details", owner: "employee" },
      { label: "Create email and system accounts", owner: "it" },
      { label: "Issue laptop and ID card", owner: "it" },
      { label: "Introduce to the team and set first-week goals", owner: "manager" },
    ],
  },
  {
    kind: "offboarding",
    name: "Standard offboarding",
    items: [
      { label: "Accept the resignation and confirm the last working day", owner: "hr" },
      { label: "Complete knowledge transfer", owner: "manager" },
      { label: "Return laptop, ID card and other assets", owner: "employee" },
      { label: "Revoke email and system access", owner: "it" },
      { label: "Hold the exit interview", owner: "hr" },
      { label: "Process the full and final settlement", owner: "hr" },
    ],
  },
];

function clearDefault(db: DbLike, kind: ChecklistKind): void {
  db.update(checklistTemplates)
    .set({ isDefault: false })
    .where(and(eq(checklistTemplates.kind, kind), eq(checklistTemplates.isDefault, true)))
    .run();
}

function requireTemplate(db: DbLike, id: number): ChecklistTemplateRow {
  const row = db.select().from(checklistTemplates).where(eq(checklistTemplates.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Checklist template not found.");
  return row;
}

export function createChecklistTemplate(db: DbLike, input: ChecklistTemplateInput): ChecklistTemplateRow {
  if (input.isDefault) clearDefault(db, input.kind);
  return db.insert(checklistTemplates).values(input).returning().get();
}

export function updateChecklistTemplate(
  db: DbLike,
  id: number,
  input: ChecklistTemplateInput,
): { before: ChecklistTemplateRow; after: ChecklistTemplateRow } {
  const before = requireTemplate(db, id);
  if (before.archived && input.isDefault) {
    throw new DomainError("ARCHIVED", "Restore this template before making it the default.");
  }
  if (input.isDefault) clearDefault(db, input.kind);
  const after = db.update(checklistTemplates).set(input).where(eq(checklistTemplates.id, id)).returning().get()!;
  return { before, after };
}

export function setChecklistTemplateArchived(db: DbLike, id: number, archived: boolean): ChecklistTemplateRow {
  requireTemplate(db, id);
  return db
    .update(checklistTemplates)
    .set(archived ? { archived, isDefault: false } : { archived })
    .where(eq(checklistTemplates.id, id))
    .returning()
    .get()!;
}

export function listChecklistTemplates(db: DbLike): ChecklistTemplateRow[] {
  return db.select().from(checklistTemplates).orderBy(asc(checklistTemplates.kind), asc(checklistTemplates.name)).all();
}

/** Copies the default template of `kind` onto the employee; null when there is no active default. */
export function instantiateChecklist(db: DbLike, employeeId: number, kind: ChecklistKind): EmployeeChecklistRow | null {
  const template = db
    .select()
    .from(checklistTemplates)
    .where(and(eq(checklistTemplates.kind, kind), eq(checklistTemplates.isDefault, true), eq(checklistTemplates.archived, false)))
    .get();
  if (!template) return null;
  return db
    .insert(employeeChecklists)
    .values({
      employeeId,
      templateId: template.id,
      kind,
      name: template.name,
      items: template.items.map((item) => ({ ...item, doneAt: null, doneBy: null, doneByName: null })),
    })
    .returning()
    .get();
}

export function listEmployeeChecklists(db: DbLike, employeeId: number): EmployeeChecklistRow[] {
  return db
    .select()
    .from(employeeChecklists)
    .where(eq(employeeChecklists.employeeId, employeeId))
    .orderBy(desc(employeeChecklists.createdAt), desc(employeeChecklists.id))
    .all();
}

export function getEmployeeChecklist(db: DbLike, id: number): EmployeeChecklistRow | undefined {
  return db.select().from(employeeChecklists).where(eq(employeeChecklists.id, id)).get();
}

/** Ticks or unticks one item. The checklist completes when every item is done and reopens when one is unticked. */
export function toggleChecklistItem(
  db: DbLike,
  checklistId: number,
  index: number,
  done: boolean,
  actor: { id: number; name: string },
): EmployeeChecklistRow {
  const checklist = getEmployeeChecklist(db, checklistId);
  if (!checklist) throw new DomainError("NOT_FOUND", "Checklist not found.");
  if (checklist.status === "cancelled") throw new DomainError("CHECKLIST_CANCELLED", "This checklist was cancelled.");
  if (!Number.isInteger(index) || index < 0 || index >= checklist.items.length) {
    throw new DomainError("NOT_FOUND", "Checklist item not found.");
  }
  const items: ChecklistItemState[] = checklist.items.map((item, i) => {
    if (i !== index) return item;
    return done
      ? { ...item, doneAt: nowIso(), doneBy: actor.id, doneByName: actor.name }
      : { ...item, doneAt: null, doneBy: null, doneByName: null };
  });
  const status = items.every((item) => item.doneAt !== null) ? "completed" : "open";
  return db.update(employeeChecklists).set({ items, status }).where(eq(employeeChecklists.id, checklistId)).returning().get()!;
}

export function cancelOpenChecklists(db: DbLike, employeeId: number, kind: ChecklistKind): number {
  return db
    .update(employeeChecklists)
    .set({ status: "cancelled" })
    .where(and(eq(employeeChecklists.employeeId, employeeId), eq(employeeChecklists.kind, kind), eq(employeeChecklists.status, "open")))
    .run().changes;
}

/** Idempotent: adds the standard template for each kind that has no templates yet. */
export function seedDefaultChecklistTemplates(db: DbLike): number {
  let created = 0;
  for (const template of DEFAULT_TEMPLATES) {
    const exists = db.select({ id: checklistTemplates.id }).from(checklistTemplates).where(eq(checklistTemplates.kind, template.kind)).get();
    if (exists) continue;
    db.insert(checklistTemplates).values({ ...template, isDefault: true }).run();
    created += 1;
  }
  return created;
}
```

- [ ] **Step 4: Seed the default templates** — replace `scripts/seed.ts`

```ts
import "./_env";
import { openDatabase } from "../src/server/db/client";
import { seedDefaultChecklistTemplates } from "../src/server/modules/employees/checklists";
import { createUser, findUserByEmail, hashPassword } from "../src/server/modules/users/service";

const file = process.env.DB_FILE ?? "./data/people.db";
const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@pvcon.in").toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe@2026";

async function main() {
  const { db } = openDatabase(file);
  const templates = db.transaction((tx) => seedDefaultChecklistTemplates(tx));
  console.log(templates ? `Added ${templates} default checklist template(s).` : "Checklist templates already present.");

  if (findUserByEmail(db, email)) {
    console.log(`Super admin ${email} already exists in ${file}; nothing to do.`);
    return;
  }
  const passwordHash = await hashPassword(password);
  db.transaction((tx) =>
    createUser(tx, { email, name: "System Admin", roles: ["super_admin"], passwordHash, mustChangePassword: true }),
  );
  console.log(`Created super admin ${email} in ${file}. Temporary password: ${password} (must change at first sign-in).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Run to verify pass, and exercise the seed on a scratch DB**

Run: `npx vitest run tests/integration/checklists.test.ts`
Expected: PASS (6 tests).

Run: `DB_FILE=./data/scratch.db npm run db:migrate && DB_FILE=./data/scratch.db npm run db:seed && DB_FILE=./data/scratch.db npm run db:seed && rm -f data/scratch.db*`
Expected: the first seed prints `Added 2 default checklist template(s).` and `Created super admin…`. The second prints `Checklist templates already present.` and `…already exists…; nothing to do.`

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/employees/checklists.ts scripts/seed.ts tests/integration/checklists.test.ts
git commit -m "feat(employees): add onboarding and offboarding checklists"
```

---
### Task 7: Employee service — create, update, logins, events

**Files:**
- Create: `src/server/modules/employees/service.ts`
- Modify: `tests/helpers/employees.ts` (add `employeeInput`)
- Test: `tests/integration/employees.test.ts`

**Interfaces:**
- Consumes:
  - `nextEmployeeCode` (Task 4), `sealBank`/`bankView`/`BankView` (Task 4), `getReportingTree` (Task 5), `instantiateChecklist` (Task 6).
  - `createUser`, `findUserByEmail`, `getUserById`, `assertCanGrantRoles` (users service); `fullName` (Task 1).
  - `PersonalInput`, `JobInput`, `BankInput`, `ContactInput` (Task 1).
- Produces:
  - `NewEmployee = PersonalInput & JobInput & BankInput & { employeeCode: string | null }`.
  - `LoginPlan = { mode: "none" } | { mode: "create"; roles: Role[]; passwordHash: string } | { mode: "link"; userId: number }`.
  - `NewEmployeeEvent`, `recordEmployeeEvent(db, event): EmployeeEventRow`, `requireEmployee(db, id): EmployeeRow`, `assertValidManager(db, employeeId | null, managerId)`.
  - `createEmployee(db, actor: SessionUser, input: NewEmployee, opts: { login: LoginPlan; onboarding: boolean }): EmployeeRow`.
  - `updateEmployeeJob(db, actorUserId, employeeId, input: JobInput, effectiveDate): { before; after }`, `updateEmployeePersonal(db, employeeId, input: PersonalInput): { before; after }`, `updateOwnContact(db, employeeId, input: ContactInput): { before; after }`.
  - `updateEmployeeBank(db, employeeId, input: BankInput): { before: BankView; after: BankView }` (masked).
  - `linkEmployeeUser(db, employeeId, userId): EmployeeRow`, `createEmployeeLogin(db, actor, employeeId, roles, passwordHash): { employee: EmployeeRow; userId: number }`.
  - Error codes: `NOT_FOUND`, `ARCHIVED`, `INVALID_MANAGER`, `MANAGER_CYCLE`, `WORK_EMAIL_TAKEN`, `CODE_TAKEN`, `WORK_EMAIL_REQUIRED`, `EMAIL_TAKEN`, `FORBIDDEN_ROLE` (from `assertCanGrantRoles`), `USER_ALREADY_LINKED`, `ALREADY_HAS_LOGIN`, `EMPLOYEE_EXITED`.
  - Test helper `employeeInput(overrides?: Partial<NewEmployee>): NewEmployee`.

- [ ] **Step 1: Add the input helper** — append to `tests/helpers/employees.ts`

```ts
import type { NewEmployee } from "@/server/modules/employees/service";

/** A valid `NewEmployee` for "Asha Rao" joining on 2026-10-01; override what a test cares about. */
export function employeeInput(overrides: Partial<NewEmployee> = {}): NewEmployee {
  return {
    firstName: "Asha", lastName: "Rao", displayName: null, workEmail: null, personalEmail: null, phone: null,
    dateOfBirth: null, gender: null, maritalStatus: null, address: null, emergencyContact: null,
    departmentId: null, designationId: null, reportingManagerId: null, employmentType: "full_time", workLocation: null,
    dateOfJoining: "2026-10-01", probationEndDate: null, confirmationDate: null, noticePeriodDays: 30,
    bankName: null, bankAccount: null, bankIfsc: null, pan: null, aadhaar: null, passport: null,
    employeeCode: null,
    ...overrides,
  };
}
```

(Move the new `import type` line to the top of the file with the other imports.)

- [ ] **Step 2: Write the failing tests** — `tests/integration/employees.test.ts`

```ts
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { JobInput } from "@/lib/validation/employees";
import type { DB } from "@/server/db/client";
import { departments, employeeEvents, employees, type EmployeeRow } from "@/server/db/schema";
import { listEmployeeChecklists, seedDefaultChecklistTemplates } from "@/server/modules/employees/checklists";
import { openBank } from "@/server/modules/employees/sensitive";
import {
  createEmployee, createEmployeeLogin, linkEmployeeUser, updateEmployeeBank, updateEmployeeJob, updateEmployeePersonal,
  updateOwnContact,
} from "@/server/modules/employees/service";
import { getUserById, getUserRoles } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { employeeInput, insertDepartment, insertDesignation, insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const none = { login: { mode: "none" as const }, onboarding: false };
const createLogin = (roles: Role[], passwordHash = "x") => ({ login: { mode: "create" as const, roles, passwordHash }, onboarding: false });
const jobOf = (row: EmployeeRow, patch: Partial<JobInput> = {}): JobInput => ({
  departmentId: row.departmentId, designationId: row.designationId, reportingManagerId: row.reportingManagerId,
  employmentType: row.employmentType, workLocation: row.workLocation, dateOfJoining: row.dateOfJoining,
  probationEndDate: row.probationEndDate, confirmationDate: row.confirmationDate, noticePeriodDays: row.noticePeriodDays,
  ...patch,
});

let db: DB;
let hr: SessionUser;
const eventsOf = (employeeId: number) =>
  db.select().from(employeeEvents).where(eq(employeeEvents.employeeId, employeeId)).all().map((e) => ({ type: e.type, from: e.from, to: e.to }));

beforeEach(() => {
  db = createTestDb();
  hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
});

describe("createEmployee", () => {
  it("assigns the next code, a display name and a joined event with readable job values", () => {
    const eng = insertDepartment(db, "Engineering");
    const consultant = insertDesignation(db, "Consultant");
    const boss = insertEmployee(db, { firstName: "Meera", lastName: "Iyer" });
    const row = createEmployee(db, hr, employeeInput({ departmentId: eng.id, designationId: consultant.id, reportingManagerId: boss.id }), none);
    expect(row).toMatchObject({ employeeCode: "PV0001", displayName: "Asha Rao", status: "active", userId: null });
    expect(eventsOf(row.id)).toEqual([
      { type: "joined", from: null, to: { department: "Engineering", designation: "Consultant", manager: "Meera Iyer" } },
    ]);
  });

  it("encrypts bank and ID numbers at rest", () => {
    const row = createEmployee(db, hr, employeeInput({ bankAccount: "123456789012", pan: "ABCDE1234F" }), none);
    expect(row.bankAccountEnc).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain("123456789012");
    expect(openBank(row)).toMatchObject({ bankAccount: "123456789012", pan: "ABCDE1234F" });
  });

  it("instantiates the onboarding checklist only when asked", () => {
    seedDefaultChecklistTemplates(db);
    const withList = createEmployee(db, hr, employeeInput(), { ...none, onboarding: true });
    const without = createEmployee(db, hr, employeeInput({ firstName: "Ravi" }), none);
    expect(listEmployeeChecklists(db, withList.id).map((c) => c.kind)).toEqual(["onboarding"]);
    expect(listEmployeeChecklists(db, without.id)).toEqual([]);
  });

  it("rejects archived departments, exited managers, reused work emails and reused codes", () => {
    const old = insertDepartment(db, "Old", { archived: true });
    const leaver = insertEmployee(db, { status: "exited" });
    createEmployee(db, hr, employeeInput({ workEmail: "asha@pvcon.in", employeeCode: "PV0100" }), none);
    expectDomainError(() => createEmployee(db, hr, employeeInput({ departmentId: old.id }), none), "ARCHIVED");
    expectDomainError(() => createEmployee(db, hr, employeeInput({ reportingManagerId: leaver.id }), none), "INVALID_MANAGER");
    expectDomainError(() => createEmployee(db, hr, employeeInput({ workEmail: "asha@pvcon.in" }), none), "WORK_EMAIL_TAKEN");
    expectDomainError(() => createEmployee(db, hr, employeeInput({ employeeCode: "PV0100" }), none), "CODE_TAKEN");
  });

  it("creates a login that must change its temporary password", () => {
    const passwordHash = bcrypt.hashSync("Temp-Passw0rd", 4);
    const row = createEmployee(db, hr, employeeInput({ workEmail: "asha@pvcon.in" }), createLogin(["employee", "manager"], passwordHash));
    const user = getUserById(db, row.userId!)!;
    expect(user).toMatchObject({ email: "asha@pvcon.in", name: "Asha Rao", mustChangePassword: true, passwordHash });
    expect(getUserRoles(db, user.id)).toEqual(["employee", "manager"]);
  });

  it("guards login creation: work email required, no privileged roles from HR, no duplicate logins", () => {
    expectDomainError(() => createEmployee(db, hr, employeeInput(), createLogin(["employee"])), "WORK_EMAIL_REQUIRED");
    expectDomainError(() => createEmployee(db, hr, employeeInput({ workEmail: "a@pvcon.in" }), createLogin(["hr_admin"])), "FORBIDDEN_ROLE");
    insertUser(db, { email: "taken@pvcon.in" });
    expectDomainError(() => createEmployee(db, hr, employeeInput({ workEmail: "taken@pvcon.in" }), createLogin(["employee"])), "EMAIL_TAKEN");
    expect(db.select().from(employees).all()).toHaveLength(0);
  });

  it("links an existing login at most once", () => {
    const user = insertUser(db, { email: "admin@pvcon.in" });
    const link = { login: { mode: "link" as const, userId: user.id }, onboarding: false };
    expect(createEmployee(db, hr, employeeInput(), link).userId).toBe(user.id);
    expectDomainError(() => createEmployee(db, hr, employeeInput({ firstName: "Ravi" }), link), "USER_ALREADY_LINKED");
  });
});

describe("updateEmployeeJob", () => {
  it("records department, designation, manager and confirmation events", () => {
    const eng = insertDepartment(db, "Engineering");
    const sales = insertDepartment(db, "Sales");
    const analyst = insertDesignation(db, "Analyst");
    const consultant = insertDesignation(db, "Consultant");
    const meera = insertEmployee(db, { firstName: "Meera", lastName: "Iyer" });
    const row = createEmployee(db, hr, employeeInput({ departmentId: eng.id, designationId: analyst.id }), none);
    const job = jobOf(row, {
      departmentId: sales.id, designationId: consultant.id, reportingManagerId: meera.id,
      workLocation: "Pune", confirmationDate: "2027-04-01", noticePeriodDays: 60,
    });
    expect(updateEmployeeJob(db, hr.id, row.id, job, "2026-11-01").after).toMatchObject({ departmentId: sales.id, workLocation: "Pune", noticePeriodDays: 60 });
    expect(eventsOf(row.id).slice(1)).toEqual([
      { type: "transferred", from: { department: "Engineering" }, to: { department: "Sales" } },
      { type: "promoted", from: { designation: "Analyst" }, to: { designation: "Consultant" } },
      { type: "manager_changed", from: { manager: null }, to: { manager: "Meera Iyer" } },
      { type: "confirmed", from: null, to: { confirmationDate: "2027-04-01" } },
    ]);
  });

  it("refuses reporting loops and self-management", () => {
    const asha = createEmployee(db, hr, employeeInput(), none);
    const ravi = createEmployee(db, hr, employeeInput({ firstName: "Ravi", reportingManagerId: asha.id }), none);
    const kiran = createEmployee(db, hr, employeeInput({ firstName: "Kiran", reportingManagerId: ravi.id }), none);
    expectDomainError(() => updateEmployeeJob(db, hr.id, asha.id, jobOf(asha, { reportingManagerId: kiran.id }), "2026-11-01"), "MANAGER_CYCLE");
    expectDomainError(() => updateEmployeeJob(db, hr.id, asha.id, jobOf(asha, { reportingManagerId: asha.id }), "2026-11-01"), "MANAGER_CYCLE");
  });

  it("keeps an unchanged archived department, but refuses to change exited employees", () => {
    const old = insertDepartment(db, "Old");
    const row = createEmployee(db, hr, employeeInput({ departmentId: old.id }), none);
    db.update(departments).set({ archived: true }).where(eq(departments.id, old.id)).run();
    expect(updateEmployeeJob(db, hr.id, row.id, jobOf(row, { workLocation: "Remote" }), "2026-11-01").after.workLocation).toBe("Remote");
    db.update(employees).set({ status: "exited" }).where(eq(employees.id, row.id)).run();
    expectDomainError(() => updateEmployeeJob(db, hr.id, row.id, jobOf(row), "2026-11-01"), "EMPLOYEE_EXITED");
  });
});

describe("personal, contact and bank updates", () => {
  it("renames the linked login along with the employee", () => {
    const user = insertUser(db);
    const row = createEmployee(db, hr, employeeInput(), { login: { mode: "link", userId: user.id }, onboarding: false });
    updateEmployeePersonal(db, row.id, employeeInput({ lastName: "Kulkarni" }));
    expect(getUserById(db, user.id)!.name).toBe("Asha Kulkarni");
  });

  it("refuses a work email another employee uses", () => {
    createEmployee(db, hr, employeeInput({ workEmail: "asha@pvcon.in" }), none);
    const ravi = createEmployee(db, hr, employeeInput({ firstName: "Ravi" }), none);
    expectDomainError(() => updateEmployeePersonal(db, ravi.id, employeeInput({ firstName: "Ravi", workEmail: "asha@pvcon.in" })), "WORK_EMAIL_TAKEN");
  });

  it("changes only contact fields for self-service", () => {
    const row = createEmployee(db, hr, employeeInput({ phone: "+91 90000 00000" }), none);
    const { after } = updateOwnContact(db, row.id, {
      personalEmail: "asha@example.com", phone: "+91 98450 12345", address: null,
      emergencyContact: { name: "Ravi Rao", relation: "Brother", phone: "+91 90000 11111" },
    });
    expect(after).toMatchObject({ phone: "+91 98450 12345", personalEmail: "asha@example.com", firstName: "Asha" });
  });

  it("returns masked before/after values for bank changes", () => {
    const row = createEmployee(db, hr, employeeInput({ bankAccount: "111122223333" }), none);
    const { before, after } = updateEmployeeBank(db, row.id, {
      bankName: "HDFC Bank", bankAccount: "444455556666", bankIfsc: "HDFC0001234", pan: null, aadhaar: null, passport: null,
    });
    expect(before.bankAccount).toBe("XXXX3333");
    expect(after).toMatchObject({ bankAccount: "XXXX6666", bankName: "HDFC Bank", masked: true });
  });
});

describe("logins for existing employees", () => {
  it("creates or links a login once, and needs a work email to create one", () => {
    const withEmail = createEmployee(db, hr, employeeInput({ workEmail: "asha@pvcon.in" }), none);
    const { employee, userId } = createEmployeeLogin(db, hr, withEmail.id, ["employee"], "x");
    expect(employee.userId).toBe(userId);
    expectDomainError(() => createEmployeeLogin(db, hr, withEmail.id, ["employee"], "x"), "ALREADY_HAS_LOGIN");

    const noEmail = createEmployee(db, hr, employeeInput({ firstName: "Ravi" }), none);
    expectDomainError(() => createEmployeeLogin(db, hr, noEmail.id, ["employee"], "x"), "WORK_EMAIL_REQUIRED");
    const user = insertUser(db);
    expect(linkEmployeeUser(db, noEmail.id, user.id).userId).toBe(user.id);
    expectDomainError(() => linkEmployeeUser(db, noEmail.id, user.id), "ALREADY_HAS_LOGIN");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/integration/employees.test.ts`
Expected: FAIL — `@/server/modules/employees/service` is missing.

- [ ] **Step 4: Implement `src/server/modules/employees/service.ts`**

```ts
import { and, eq, ne } from "drizzle-orm";
import type { Role } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { ISODate } from "@/lib/dates";
import { fullName, type EmployeeEventType, type EventValues } from "@/lib/hr";
import type { BankInput, ContactInput, JobInput, PersonalInput } from "@/lib/validation/employees";
import type { DbLike } from "@/server/db/client";
import {
  departments, designations, employeeEvents, employees, users, type EmployeeEventRow, type EmployeeRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { assertCanGrantRoles, createUser, findUserByEmail, getUserById } from "@/server/modules/users/service";
import { instantiateChecklist } from "./checklists";
import { nextEmployeeCode } from "./code";
import { getReportingTree } from "./scope";
import { bankView, sealBank, type BankView } from "./sensitive";

export type NewEmployee = PersonalInput & JobInput & BankInput & { employeeCode: string | null };

export type LoginPlan =
  | { mode: "none" }
  | { mode: "create"; roles: Role[]; passwordHash: string }
  | { mode: "link"; userId: number };

export interface NewEmployeeEvent {
  employeeId: number;
  type: EmployeeEventType;
  effectiveDate: ISODate;
  from?: EventValues | null;
  to?: EventValues | null;
  note?: string | null;
  createdBy: number | null;
}

export function recordEmployeeEvent(db: DbLike, event: NewEmployeeEvent): EmployeeEventRow {
  return db
    .insert(employeeEvents)
    .values({ ...event, from: event.from ?? null, to: event.to ?? null, note: event.note ?? null })
    .returning()
    .get();
}

export function requireEmployee(db: DbLike, id: number): EmployeeRow {
  const row = db.select().from(employees).where(eq(employees.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Employee not found.");
  return row;
}

function departmentName(db: DbLike, id: number | null): string | null {
  if (id === null) return null;
  return db.select({ name: departments.name }).from(departments).where(eq(departments.id, id)).get()?.name ?? null;
}

function designationName(db: DbLike, id: number | null): string | null {
  if (id === null) return null;
  return db.select({ name: designations.name }).from(designations).where(eq(designations.id, id)).get()?.name ?? null;
}

function employeeName(db: DbLike, id: number | null): string | null {
  if (id === null) return null;
  return db.select({ name: employees.displayName }).from(employees).where(eq(employees.id, id)).get()?.name ?? null;
}

/** New assignments must point at an active department; keeping the current (even archived) one is fine. */
function assertDepartment(db: DbLike, id: number | null, current: number | null): void {
  if (id === null || id === current) return;
  const row = db.select({ archived: departments.archived }).from(departments).where(eq(departments.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Department not found.", { departmentId: ["Not found"] });
  if (row.archived) throw new DomainError("ARCHIVED", "That department is archived.", { departmentId: ["Archived"] });
}

function assertDesignation(db: DbLike, id: number | null, current: number | null): void {
  if (id === null || id === current) return;
  const row = db.select({ archived: designations.archived }).from(designations).where(eq(designations.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Designation not found.", { designationId: ["Not found"] });
  if (row.archived) throw new DomainError("ARCHIVED", "That designation is archived.", { designationId: ["Archived"] });
}

/** A manager must be a current employee who is not the employee or anyone below them (no reporting loops). */
export function assertValidManager(db: DbLike, employeeId: number | null, managerId: number): void {
  if (employeeId !== null && managerId === employeeId) {
    throw new DomainError("MANAGER_CYCLE", "An employee can't report to themselves.", { reportingManagerId: ["Can't be the same person"] });
  }
  const manager = db.select({ status: employees.status }).from(employees).where(eq(employees.id, managerId)).get();
  if (!manager || manager.status === "exited") {
    throw new DomainError("INVALID_MANAGER", "Choose a current employee as manager.", { reportingManagerId: ["Not a current employee"] });
  }
  if (employeeId !== null && getReportingTree(db, employeeId).includes(managerId)) {
    throw new DomainError("MANAGER_CYCLE", "That person reports to this employee, so they can't be their manager.", {
      reportingManagerId: ["Would create a reporting loop"],
    });
  }
}

function assertWorkEmailFree(db: DbLike, email: string | null, exceptId: number | null): void {
  if (!email) return;
  const clash = db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.workEmail, email), exceptId === null ? undefined : ne(employees.id, exceptId)))
    .get();
  if (clash) throw new DomainError("WORK_EMAIL_TAKEN", "Another employee already uses this work email.", { workEmail: ["Already used"] });
}

function assertLoginEmailFree(db: DbLike, email: string): void {
  if (findUserByEmail(db, email)) {
    throw new DomainError("EMAIL_TAKEN", "A login already exists for this email. Link it instead.", {
      workEmail: ["A login already uses this email; link it instead"],
    });
  }
}

function assertLinkableUser(db: DbLike, userId: number): void {
  if (!getUserById(db, userId)) throw new DomainError("NOT_FOUND", "User not found.", { linkUserId: ["Not found"] });
  const linked = db.select({ id: employees.id }).from(employees).where(eq(employees.userId, userId)).get();
  if (linked) throw new DomainError("USER_ALREADY_LINKED", "That login already belongs to another employee.", { linkUserId: ["Already linked"] });
}

function jobSnapshot(db: DbLike, row: Pick<EmployeeRow, "departmentId" | "designationId" | "reportingManagerId">): EventValues {
  return {
    department: departmentName(db, row.departmentId),
    designation: designationName(db, row.designationId),
    manager: employeeName(db, row.reportingManagerId),
  };
}

function personalColumns(input: PersonalInput) {
  return {
    firstName: input.firstName,
    lastName: input.lastName,
    displayName: input.displayName ?? fullName(input.firstName, input.lastName),
    workEmail: input.workEmail,
    personalEmail: input.personalEmail,
    phone: input.phone,
    dateOfBirth: input.dateOfBirth,
    gender: input.gender,
    maritalStatus: input.maritalStatus,
    address: input.address,
    emergencyContact: input.emergencyContact,
  };
}

function jobColumns(input: JobInput) {
  return {
    departmentId: input.departmentId,
    designationId: input.designationId,
    reportingManagerId: input.reportingManagerId,
    employmentType: input.employmentType,
    workLocation: input.workLocation,
    dateOfJoining: input.dateOfJoining,
    probationEndDate: input.probationEndDate,
    confirmationDate: input.confirmationDate,
    noticePeriodDays: input.noticePeriodDays,
  };
}

/** Run inside a transaction: it may also create the login and the onboarding checklist. */
export function createEmployee(
  db: DbLike,
  actor: SessionUser,
  input: NewEmployee,
  opts: { login: LoginPlan; onboarding: boolean },
): EmployeeRow {
  assertDepartment(db, input.departmentId, null);
  assertDesignation(db, input.designationId, null);
  if (input.reportingManagerId !== null) assertValidManager(db, null, input.reportingManagerId);
  assertWorkEmailFree(db, input.workEmail, null);
  const employeeCode = input.employeeCode ?? nextEmployeeCode(db);
  if (db.select({ id: employees.id }).from(employees).where(eq(employees.employeeCode, employeeCode)).get()) {
    throw new DomainError("CODE_TAKEN", `Employee code ${employeeCode} is already used.`, { employeeCode: ["Already used"] });
  }
  const personal = personalColumns(input);

  let userId: number | null = null;
  if (opts.login.mode === "create") {
    if (!input.workEmail) {
      throw new DomainError("WORK_EMAIL_REQUIRED", "A work email is required to create a login.", { workEmail: ["Required to create a login"] });
    }
    assertCanGrantRoles(actor, opts.login.roles);
    assertLoginEmailFree(db, input.workEmail);
    userId = createUser(db, {
      email: input.workEmail,
      name: personal.displayName,
      roles: opts.login.roles,
      passwordHash: opts.login.passwordHash,
      mustChangePassword: true,
    }).id;
  } else if (opts.login.mode === "link") {
    assertLinkableUser(db, opts.login.userId);
    userId = opts.login.userId;
  }

  const row = db
    .insert(employees)
    .values({ ...personal, ...jobColumns(input), ...sealBank(input), employeeCode, userId })
    .returning()
    .get();
  recordEmployeeEvent(db, { employeeId: row.id, type: "joined", effectiveDate: row.dateOfJoining, to: jobSnapshot(db, row), createdBy: actor.id });
  if (opts.onboarding) instantiateChecklist(db, row.id, "onboarding");
  return row;
}

/** Job fields; every department, designation or manager change adds an `employee_events` row (spec §5.1). */
export function updateEmployeeJob(
  db: DbLike,
  actorUserId: number,
  employeeId: number,
  input: JobInput,
  effectiveDate: ISODate,
): { before: EmployeeRow; after: EmployeeRow } {
  const before = requireEmployee(db, employeeId);
  if (before.status === "exited") throw new DomainError("EMPLOYEE_EXITED", "Exited employees can't be changed.");
  assertDepartment(db, input.departmentId, before.departmentId);
  assertDesignation(db, input.designationId, before.designationId);
  if (input.reportingManagerId !== null && input.reportingManagerId !== before.reportingManagerId) {
    assertValidManager(db, employeeId, input.reportingManagerId);
  }
  if (input.reportingManagerId === employeeId) assertValidManager(db, employeeId, employeeId);
  const after = db.update(employees).set(jobColumns(input)).where(eq(employees.id, employeeId)).returning().get()!;

  const base = { employeeId, effectiveDate, createdBy: actorUserId };
  if (before.departmentId !== after.departmentId) {
    recordEmployeeEvent(db, {
      ...base, type: "transferred",
      from: { department: departmentName(db, before.departmentId) }, to: { department: departmentName(db, after.departmentId) },
    });
  }
  if (before.designationId !== after.designationId) {
    recordEmployeeEvent(db, {
      ...base, type: "promoted",
      from: { designation: designationName(db, before.designationId) }, to: { designation: designationName(db, after.designationId) },
    });
  }
  if (before.reportingManagerId !== after.reportingManagerId) {
    recordEmployeeEvent(db, {
      ...base, type: "manager_changed",
      from: { manager: employeeName(db, before.reportingManagerId) }, to: { manager: employeeName(db, after.reportingManagerId) },
    });
  }
  if (!before.confirmationDate && after.confirmationDate) {
    recordEmployeeEvent(db, {
      employeeId, type: "confirmed", effectiveDate: after.confirmationDate,
      to: { confirmationDate: after.confirmationDate }, createdBy: actorUserId,
    });
  }
  return { before, after };
}

export function updateEmployeePersonal(db: DbLike, employeeId: number, input: PersonalInput): { before: EmployeeRow; after: EmployeeRow } {
  const before = requireEmployee(db, employeeId);
  assertWorkEmailFree(db, input.workEmail, employeeId);
  const after = db.update(employees).set(personalColumns(input)).where(eq(employees.id, employeeId)).returning().get()!;
  if (after.userId !== null && after.displayName !== before.displayName) {
    db.update(users).set({ name: after.displayName }).where(eq(users.id, after.userId)).run();
  }
  return { before, after };
}

/** Self-service: the contact fields employees may change without approval (spec §5.1). */
export function updateOwnContact(db: DbLike, employeeId: number, input: ContactInput): { before: EmployeeRow; after: EmployeeRow } {
  const before = requireEmployee(db, employeeId);
  const after = db
    .update(employees)
    .set({ personalEmail: input.personalEmail, phone: input.phone, address: input.address, emergencyContact: input.emergencyContact })
    .where(eq(employees.id, employeeId))
    .returning()
    .get()!;
  return { before, after };
}

/** Returns masked views so callers can audit the change without storing secrets. */
export function updateEmployeeBank(db: DbLike, employeeId: number, input: BankInput): { before: BankView; after: BankView } {
  const row = requireEmployee(db, employeeId);
  const updated = db.update(employees).set(sealBank(input)).where(eq(employees.id, employeeId)).returning().get()!;
  return { before: bankView(row, false), after: bankView(updated, false) };
}

export function linkEmployeeUser(db: DbLike, employeeId: number, userId: number): EmployeeRow {
  const employee = requireEmployee(db, employeeId);
  if (employee.userId !== null) throw new DomainError("ALREADY_HAS_LOGIN", "This employee already has a login.");
  assertLinkableUser(db, userId);
  return db.update(employees).set({ userId }).where(eq(employees.id, employeeId)).returning().get()!;
}

export function createEmployeeLogin(
  db: DbLike,
  actor: SessionUser,
  employeeId: number,
  roles: Role[],
  passwordHash: string,
): { employee: EmployeeRow; userId: number } {
  const employee = requireEmployee(db, employeeId);
  if (employee.userId !== null) throw new DomainError("ALREADY_HAS_LOGIN", "This employee already has a login.");
  if (employee.status === "exited") throw new DomainError("EMPLOYEE_EXITED", "Exited employees can't get a login.");
  if (!employee.workEmail) throw new DomainError("WORK_EMAIL_REQUIRED", "Add a work email before creating a login.");
  assertCanGrantRoles(actor, roles);
  assertLoginEmailFree(db, employee.workEmail);
  const user = createUser(db, { email: employee.workEmail, name: employee.displayName, roles, passwordHash, mustChangePassword: true });
  const updated = db.update(employees).set({ userId: user.id }).where(eq(employees.id, employeeId)).returning().get()!;
  return { employee: updated, userId: user.id };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/integration/employees.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/employees/service.ts tests/helpers/employees.ts tests/integration/employees.test.ts
git commit -m "feat(employees): add employee create, update, login and event services"
```

---

### Task 8: Employee read models

**Files:**
- Create: `src/server/modules/employees/queries.ts`
- Test: `tests/integration/employee-queries.test.ts`

**Interfaces:**
- Consumes: schema (Task 2); `bankView`/`BankView` (Task 4); `getUserRoles`; `createEmployee` (Task 7, tests only).
- Produces:
  - `EmployeeListItem`, `listEmployees(db): EmployeeListItem[]`.
  - `EmployeeDetail` and `getEmployeeDetail(db, id, { revealSensitive }): EmployeeDetail | null`. The detail never contains encrypted columns, and `bank` is a `BankView`.
  - `DirectoryEntry`, `listDirectory(db)` (current employees only).
  - `OrgChartNode` (`{ id, displayName, employeeCode, designationName, departmentName, reports: OrgChartNode[] }`), `buildOrgChart(db): OrgChartNode[]`.
  - `EmployeeEventView`, `listEmployeeEvents(db, employeeId)` (newest first).
  - `employeeOptions(db): SelectOption[]` (current employees, label `Name (CODE)`), `unlinkedUserOptions(db): SelectOption[]` (active users without an employee, label `Name <email>`).
  - `getEmployeeByUserId(db, userId): EmployeeRow | undefined`.

- [ ] **Step 1: Write the failing tests** — `tests/integration/employee-queries.test.ts`

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { employees, users } from "@/server/db/schema";
import {
  buildOrgChart, employeeOptions, getEmployeeByUserId, getEmployeeDetail, listDirectory, listEmployeeEvents, listEmployees,
  unlinkedUserOptions, type OrgChartNode,
} from "@/server/modules/employees/queries";
import { createEmployee, recordEmployeeEvent } from "@/server/modules/employees/service";
import { createTestDb } from "../helpers/db";
import { employeeInput, insertDepartment, insertDesignation, insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const none = { login: { mode: "none" as const }, onboarding: false };
const shape = (nodes: OrgChartNode[]): unknown[] => nodes.map((n) => [n.displayName, shape(n.reports)]);

let db: DB;
let hr: SessionUser;
beforeEach(() => {
  db = createTestDb();
  hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"], name: "Hari Rao" }));
});

describe("employee lists and detail", () => {
  it("lists employees with department, designation, manager and login flag", () => {
    const eng = insertDepartment(db, "Engineering");
    const consultant = insertDesignation(db, "Consultant");
    const meera = createEmployee(db, hr, employeeInput({ firstName: "Meera", lastName: "Iyer" }), none);
    const user = insertUser(db);
    createEmployee(db, hr, employeeInput({ departmentId: eng.id, designationId: consultant.id, reportingManagerId: meera.id }), {
      login: { mode: "link", userId: user.id }, onboarding: false,
    });
    expect(listEmployees(db).find((e) => e.displayName === "Asha Rao")).toMatchObject({
      employeeCode: "PV0002", departmentName: "Engineering", designationName: "Consultant", managerName: "Meera Iyer", hasLogin: true, status: "active",
    });
  });

  it("returns a detail view with no encrypted fields, masked unless revealed", () => {
    const row = createEmployee(db, hr, employeeInput({ bankAccount: "123456789012", pan: "ABCDE1234F" }), none);
    const masked = getEmployeeDetail(db, row.id, { revealSensitive: false })!;
    expect(Object.keys(masked).filter((k) => /enc$/i.test(k))).toEqual([]);
    expect(JSON.stringify(masked)).not.toContain("123456789012");
    expect(masked.bank).toMatchObject({ bankAccount: "XXXX9012", pan: "XXXX234F", masked: true });
    expect(getEmployeeDetail(db, row.id, { revealSensitive: true })!.bank.bankAccount).toBe("123456789012");
    expect(getEmployeeDetail(db, 9999, { revealSensitive: false })).toBeNull();
  });

  it("includes the login with roles and only current direct reports", () => {
    const user = insertUser(db, { email: "asha@pvcon.in", roles: ["employee", "manager"] });
    const asha = createEmployee(db, hr, employeeInput(), { login: { mode: "link", userId: user.id }, onboarding: false });
    createEmployee(db, hr, employeeInput({ firstName: "Ravi", lastName: "Menon", reportingManagerId: asha.id }), none);
    insertEmployee(db, { reportingManagerId: asha.id, status: "exited" });
    const detail = getEmployeeDetail(db, asha.id, { revealSensitive: false })!;
    expect(detail.user).toEqual({ id: user.id, email: "asha@pvcon.in", status: "active", roles: ["employee", "manager"] });
    expect(detail.directReports.map((r) => r.displayName)).toEqual(["Ravi Menon"]);
    expect(getEmployeeByUserId(db, user.id)?.id).toBe(asha.id);
  });
});

describe("directory and org chart", () => {
  it("covers current employees only, nested by reporting line", () => {
    const ceo = insertEmployee(db, { firstName: "Meera", lastName: "Iyer" });
    const asha = insertEmployee(db, { firstName: "Asha", lastName: "Rao", reportingManagerId: ceo.id });
    insertEmployee(db, { firstName: "Ravi", lastName: "Menon", reportingManagerId: asha.id });
    insertEmployee(db, { firstName: "Old", lastName: "Timer", reportingManagerId: ceo.id, status: "exited" });
    expect(listDirectory(db).map((d) => d.displayName)).toEqual(["Asha Rao", "Meera Iyer", "Ravi Menon"]);
    expect(shape(buildOrgChart(db))).toEqual([["Meera Iyer", [["Asha Rao", [["Ravi Menon", []]]]]]]);
  });

  it("still shows every member of a stored reporting loop", () => {
    const a = insertEmployee(db, { firstName: "Asha", lastName: "Rao" });
    const b = insertEmployee(db, { firstName: "Ravi", lastName: "Menon", reportingManagerId: a.id });
    db.update(employees).set({ reportingManagerId: b.id }).where(eq(employees.id, a.id)).run();
    const names = JSON.stringify(shape(buildOrgChart(db)));
    expect(names).toContain("Asha Rao");
    expect(names).toContain("Ravi Menon");
  });
});

describe("events and pickers", () => {
  it("lists events newest first with the author's name", () => {
    const row = createEmployee(db, hr, employeeInput(), none);
    recordEmployeeEvent(db, { employeeId: row.id, type: "confirmed", effectiveDate: "2027-04-01", to: { confirmationDate: "2027-04-01" }, createdBy: hr.id });
    expect(listEmployeeEvents(db, row.id).map((e) => [e.type, e.effectiveDate, e.createdByName])).toEqual([
      ["confirmed", "2027-04-01", "Hari Rao"],
      ["joined", "2026-10-01", "Hari Rao"],
    ]);
  });

  it("offers current employees and unlinked active logins", () => {
    const linked = insertUser(db, { name: "Asha Rao", email: "asha@pvcon.in" });
    insertUser(db, { name: "Free User", email: "free@pvcon.in" });
    const disabled = insertUser(db, { name: "Gone User", email: "gone@pvcon.in" });
    db.update(users).set({ status: "disabled" }).where(eq(users.id, disabled.id)).run();
    const asha = createEmployee(db, hr, employeeInput(), { login: { mode: "link", userId: linked.id }, onboarding: false });
    insertEmployee(db, { status: "exited" });
    expect(employeeOptions(db)).toEqual([{ id: asha.id, label: `Asha Rao (${asha.employeeCode})` }]);
    expect(unlinkedUserOptions(db).map((o) => o.label)).toEqual(["Free User <free@pvcon.in>", "Hari Rao <" + hr.email + ">"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/employee-queries.test.ts`
Expected: FAIL — `@/server/modules/employees/queries` is missing.

- [ ] **Step 3: Implement `src/server/modules/employees/queries.ts`**

```ts
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Role } from "@/lib/auth/permissions";
import type {
  Address, EmergencyContact, EmployeeEventType, EmployeeStatus, EmploymentType, EventValues, Gender, MaritalStatus, SelectOption,
} from "@/lib/hr";
import type { DbLike } from "@/server/db/client";
import { departments, designations, employeeEvents, employees, users, type EmployeeRow } from "@/server/db/schema";
import { getUserRoles } from "@/server/modules/users/service";
import { bankView, type BankView } from "./sensitive";

const CURRENT = ["active", "on_notice"] as const;

export interface EmployeeListItem {
  id: number;
  employeeCode: string;
  displayName: string;
  workEmail: string | null;
  departmentId: number | null;
  departmentName: string | null;
  designationName: string | null;
  managerName: string | null;
  status: EmployeeStatus;
  dateOfJoining: string;
  hasLogin: boolean;
}

export function listEmployees(db: DbLike): EmployeeListItem[] {
  const manager = alias(employees, "manager");
  return db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      displayName: employees.displayName,
      workEmail: employees.workEmail,
      departmentId: employees.departmentId,
      departmentName: departments.name,
      designationName: designations.name,
      managerName: manager.displayName,
      status: employees.status,
      dateOfJoining: employees.dateOfJoining,
      userId: employees.userId,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(manager, eq(manager.id, employees.reportingManagerId))
    .orderBy(asc(employees.displayName))
    .all()
    .map((row) => ({
      id: row.id,
      employeeCode: row.employeeCode,
      displayName: row.displayName,
      workEmail: row.workEmail,
      departmentId: row.departmentId,
      departmentName: row.departmentName,
      designationName: row.designationName,
      managerName: row.managerName,
      status: row.status,
      dateOfJoining: row.dateOfJoining,
      hasLogin: row.userId !== null,
    }));
}

export interface EmployeeDetail {
  id: number;
  employeeCode: string;
  firstName: string;
  lastName: string;
  displayName: string;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  maritalStatus: MaritalStatus | null;
  address: Address | null;
  emergencyContact: EmergencyContact | null;
  departmentId: number | null;
  departmentName: string | null;
  designationId: number | null;
  designationName: string | null;
  reportingManagerId: number | null;
  managerName: string | null;
  managerCode: string | null;
  employmentType: EmploymentType;
  workLocation: string | null;
  dateOfJoining: string;
  probationEndDate: string | null;
  confirmationDate: string | null;
  noticePeriodDays: number;
  status: EmployeeStatus;
  resignationDate: string | null;
  lastWorkingDate: string | null;
  exitReason: string | null;
  bank: BankView;
  user: { id: number; email: string; status: "active" | "disabled"; roles: Role[] } | null;
  directReports: { id: number; displayName: string; employeeCode: string }[];
}

/** Whitelists fields explicitly so encrypted columns can never reach a client component. */
export function getEmployeeDetail(db: DbLike, id: number, opts: { revealSensitive: boolean }): EmployeeDetail | null {
  const manager = alias(employees, "manager");
  const row = db
    .select({
      employee: employees,
      departmentName: departments.name,
      designationName: designations.name,
      managerName: manager.displayName,
      managerCode: manager.employeeCode,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(manager, eq(manager.id, employees.reportingManagerId))
    .where(eq(employees.id, id))
    .get();
  if (!row) return null;
  const e = row.employee;
  const login =
    e.userId === null
      ? undefined
      : db.select({ id: users.id, email: users.email, status: users.status }).from(users).where(eq(users.id, e.userId)).get();
  const directReports = db
    .select({ id: employees.id, displayName: employees.displayName, employeeCode: employees.employeeCode })
    .from(employees)
    .where(and(eq(employees.reportingManagerId, e.id), inArray(employees.status, [...CURRENT])))
    .orderBy(asc(employees.displayName))
    .all();
  return {
    id: e.id,
    employeeCode: e.employeeCode,
    firstName: e.firstName,
    lastName: e.lastName,
    displayName: e.displayName,
    workEmail: e.workEmail,
    personalEmail: e.personalEmail,
    phone: e.phone,
    dateOfBirth: e.dateOfBirth,
    gender: e.gender,
    maritalStatus: e.maritalStatus,
    address: e.address,
    emergencyContact: e.emergencyContact,
    departmentId: e.departmentId,
    departmentName: row.departmentName,
    designationId: e.designationId,
    designationName: row.designationName,
    reportingManagerId: e.reportingManagerId,
    managerName: row.managerName,
    managerCode: row.managerCode,
    employmentType: e.employmentType,
    workLocation: e.workLocation,
    dateOfJoining: e.dateOfJoining,
    probationEndDate: e.probationEndDate,
    confirmationDate: e.confirmationDate,
    noticePeriodDays: e.noticePeriodDays,
    status: e.status,
    resignationDate: e.resignationDate,
    lastWorkingDate: e.lastWorkingDate,
    exitReason: e.exitReason,
    bank: bankView(e, opts.revealSensitive),
    user: login ? { ...login, roles: getUserRoles(db, login.id) } : null,
    directReports,
  };
}

export interface DirectoryEntry {
  id: number;
  employeeCode: string;
  displayName: string;
  designationName: string | null;
  departmentId: number | null;
  departmentName: string | null;
  workEmail: string | null;
  phone: string | null;
  managerName: string | null;
  status: EmployeeStatus;
}

export function listDirectory(db: DbLike): DirectoryEntry[] {
  const manager = alias(employees, "manager");
  return db
    .select({
      id: employees.id,
      employeeCode: employees.employeeCode,
      displayName: employees.displayName,
      designationName: designations.name,
      departmentId: employees.departmentId,
      departmentName: departments.name,
      workEmail: employees.workEmail,
      phone: employees.phone,
      managerName: manager.displayName,
      status: employees.status,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .leftJoin(manager, eq(manager.id, employees.reportingManagerId))
    .where(inArray(employees.status, [...CURRENT]))
    .orderBy(asc(employees.displayName))
    .all();
}

export interface OrgChartNode {
  id: number;
  displayName: string;
  employeeCode: string;
  designationName: string | null;
  departmentName: string | null;
  reports: OrgChartNode[];
}

/** Current employees nested by reporting line. Members of a stored reporting loop are surfaced at the top level. */
export function buildOrgChart(db: DbLike): OrgChartNode[] {
  const rows = db
    .select({
      id: employees.id,
      displayName: employees.displayName,
      employeeCode: employees.employeeCode,
      designationName: designations.name,
      departmentName: departments.name,
      managerId: employees.reportingManagerId,
    })
    .from(employees)
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(designations, eq(designations.id, employees.designationId))
    .where(inArray(employees.status, [...CURRENT]))
    .orderBy(asc(employees.displayName))
    .all();
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<number, number[]>();
  const roots: number[] = [];
  for (const r of rows) {
    if (r.managerId !== null && r.managerId !== r.id && ids.has(r.managerId)) {
      children.set(r.managerId, [...(children.get(r.managerId) ?? []), r.id]);
    } else {
      roots.push(r.id);
    }
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const visited = new Set<number>();
  const build = (id: number): OrgChartNode => {
    visited.add(id);
    const r = byId.get(id)!;
    const reports = (children.get(id) ?? []).filter((child) => !visited.has(child)).map(build);
    return {
      id: r.id,
      displayName: r.displayName,
      employeeCode: r.employeeCode,
      designationName: r.designationName,
      departmentName: r.departmentName,
      reports,
    };
  };
  const tree = roots.map(build);
  for (const r of rows) if (!visited.has(r.id)) tree.push(build(r.id));
  return tree;
}

export interface EmployeeEventView {
  id: number;
  type: EmployeeEventType;
  effectiveDate: string;
  from: EventValues | null;
  to: EventValues | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

export function listEmployeeEvents(db: DbLike, employeeId: number): EmployeeEventView[] {
  return db
    .select({
      id: employeeEvents.id,
      type: employeeEvents.type,
      effectiveDate: employeeEvents.effectiveDate,
      from: employeeEvents.from,
      to: employeeEvents.to,
      note: employeeEvents.note,
      createdByName: users.name,
      createdAt: employeeEvents.createdAt,
    })
    .from(employeeEvents)
    .leftJoin(users, eq(users.id, employeeEvents.createdBy))
    .where(eq(employeeEvents.employeeId, employeeId))
    .orderBy(desc(employeeEvents.effectiveDate), desc(employeeEvents.id))
    .all();
}

export function employeeOptions(db: DbLike): SelectOption[] {
  return db
    .select({ id: employees.id, name: employees.displayName, code: employees.employeeCode })
    .from(employees)
    .where(inArray(employees.status, [...CURRENT]))
    .orderBy(asc(employees.displayName))
    .all()
    .map((row) => ({ id: row.id, label: `${row.name} (${row.code})` }));
}

export function unlinkedUserOptions(db: DbLike): SelectOption[] {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(and(isNull(employees.id), eq(users.status, "active")))
    .orderBy(asc(users.name))
    .all()
    .map((row) => ({ id: row.id, label: `${row.name} <${row.email}>` }));
}

export function getEmployeeByUserId(db: DbLike, userId: number): EmployeeRow | undefined {
  return db.select().from(employees).where(eq(employees.userId, userId)).get();
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/integration/employee-queries.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/employees/queries.ts tests/integration/employee-queries.test.ts
git commit -m "feat(employees): add list, detail, directory and org chart read models"
```

---

### Task 9: Exit flow and the `employee:lifecycle` job

**Files:**
- Create: `src/server/modules/employees/lifecycle.ts`, `src/server/jobs/employee-lifecycle.ts`
- Modify: `src/server/jobs/registry.ts`, `src/server/modules/users/service.ts` (append `deactivateUserForExit`)
- Test: `tests/integration/lifecycle.test.ts`

**Interfaces:**
- Consumes:
  - `requireEmployee`, `recordEmployeeEvent` (Task 7); `instantiateChecklist`, `cancelOpenChecklists` (Task 6); `activeUserIdsWithPermission` (Task 5).
  - `notifyMany`, `writeAudit`, `runJobByName`, `addDays`, `formatDate`, `dateInTimeZone`; `ResignationInput` (Task 1).
- Produces:
  - `recordResignation(db, actorUserId, employeeId, input: ResignationInput): EmployeeRow` (errors `NOT_ACTIVE`, `INVALID_DATES`); `withdrawResignation(db, employeeId): EmployeeRow` (error `NOT_ON_NOTICE`).
  - `ExitOutcome`, `processExits(db, today): ExitOutcome[]`, `sendProbationReminders(db, today): number`.
  - `employeeLifecycleJob` registered in `JOBS` as `employee:lifecycle` (run key = company-local date).
  - `ExitLoginOutcome`, `deactivateUserForExit(db, userId): ExitLoginOutcome` in the users service.

- [ ] **Step 1: Write the failing tests** — `tests/integration/lifecycle.test.ts`

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, employeeEvents, employees, notifications } from "@/server/db/schema";
import { runJobByName } from "@/server/jobs/registry";
import { listEmployeeChecklists, seedDefaultChecklistTemplates } from "@/server/modules/employees/checklists";
import { recordResignation, sendProbationReminders, withdrawResignation } from "@/server/modules/employees/lifecycle";
import { createEmployee } from "@/server/modules/employees/service";
import { getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { employeeInput, insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const none = { login: { mode: "none" as const }, onboarding: false };
let db: DB;
let hr: SessionUser;
const employee = (id: number) => db.select().from(employees).where(eq(employees.id, id)).get()!;

beforeEach(() => {
  db = createTestDb();
  hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
  seedDefaultChecklistTemplates(db);
});

describe("resignation", () => {
  it("puts an active employee on notice with an event and an offboarding checklist", () => {
    const row = createEmployee(db, hr, employeeInput(), none);
    const after = recordResignation(db, hr.id, row.id, { resignationDate: "2026-11-01", lastWorkingDate: "2026-11-30", exitReason: "Relocating" });
    expect(after).toMatchObject({ status: "on_notice", resignationDate: "2026-11-01", lastWorkingDate: "2026-11-30", exitReason: "Relocating" });
    const resigned = db.select().from(employeeEvents).where(eq(employeeEvents.type, "resigned")).get();
    expect(resigned).toMatchObject({ effectiveDate: "2026-11-01", to: { status: "on_notice", lastWorkingDate: "2026-11-30" } });
    expect(listEmployeeChecklists(db, row.id).map((c) => c.kind)).toEqual(["offboarding"]);
  });

  it("accepts only active employees and a last working day on or after the resignation date", () => {
    const row = createEmployee(db, hr, employeeInput(), none);
    expectDomainError(() => recordResignation(db, hr.id, row.id, { resignationDate: "2026-11-10", lastWorkingDate: "2026-11-01", exitReason: null }), "INVALID_DATES");
    recordResignation(db, hr.id, row.id, { resignationDate: "2026-11-01", lastWorkingDate: "2026-11-30", exitReason: null });
    expectDomainError(() => recordResignation(db, hr.id, row.id, { resignationDate: "2026-11-01", lastWorkingDate: "2026-11-30", exitReason: null }), "NOT_ACTIVE");
  });

  it("withdrawal restores active status and cancels the open offboarding checklist", () => {
    const row = createEmployee(db, hr, employeeInput(), none);
    expectDomainError(() => withdrawResignation(db, row.id), "NOT_ON_NOTICE");
    recordResignation(db, hr.id, row.id, { resignationDate: "2026-11-01", lastWorkingDate: "2026-11-30", exitReason: "x" });
    expect(withdrawResignation(db, row.id)).toMatchObject({ status: "active", resignationDate: null, lastWorkingDate: null, exitReason: null });
    expect(listEmployeeChecklists(db, row.id).map((c) => c.status)).toEqual(["cancelled"]);
  });
});

describe("employee:lifecycle job", () => {
  // 19:00 UTC on 1 Oct is 00:30 on 2 Oct in Asia/Kolkata (the company default time zone).
  const at = new Date("2026-10-01T19:00:00Z");

  it("exits employees the day after their last working day in the company time zone, once", () => {
    const user = insertUser(db, { roles: ["employee"] });
    const leaving = insertEmployee(db, { status: "on_notice", lastWorkingDate: "2026-10-01", userId: user.id });
    const staying = insertEmployee(db, { status: "on_notice", lastWorkingDate: "2026-10-02" });

    expect(runJobByName(db, "employee:lifecycle", at)).toMatchObject({
      status: "succeeded",
      detail: "Exited 1 employee(s); sent 0 probation reminder(s)",
    });
    expect(employee(leaving.id).status).toBe("exited");
    expect(employee(staying.id).status).toBe("on_notice");
    expect(getUserById(db, user.id)).toMatchObject({ status: "disabled", sessionVersion: user.sessionVersion + 1 });
    expect(db.select().from(employeeEvents).where(eq(employeeEvents.employeeId, leaving.id)).get()).toMatchObject({
      type: "exited", effectiveDate: "2026-10-01",
    });
    expect(db.select().from(auditLogs).where(eq(auditLogs.action, "employee.exit")).all()).toHaveLength(1);
    expect(runJobByName(db, "employee:lifecycle", at).status).toBe("skipped");
  });

  it("keeps the login of the last active super admin", () => {
    const root = insertUser(db, { roles: ["super_admin"] });
    insertEmployee(db, { status: "on_notice", lastWorkingDate: "2026-09-30", userId: root.id });
    runJobByName(db, "employee:lifecycle", at);
    expect(getUserById(db, root.id)!.status).toBe("active");
  });

  it("reminds HR once about probations ending within a week", () => {
    const due = insertEmployee(db, { firstName: "Asha", lastName: "Rao", probationEndDate: "2026-10-05" });
    insertEmployee(db, { probationEndDate: "2026-10-20" });
    insertEmployee(db, { probationEndDate: "2026-10-04", confirmationDate: "2026-10-01" });
    insertEmployee(db, { probationEndDate: "2026-10-01" });

    expect(sendProbationReminders(db, "2026-10-02")).toBe(1);
    expect(sendProbationReminders(db, "2026-10-02")).toBe(0);
    const sent = db.select().from(notifications).all();
    expect(sent.map((n) => n.userId)).toEqual([hr.id]);
    expect(sent[0]).toMatchObject({ type: "employee.probation_due", link: `/org/employees/${due.id}?tab=job` });
    expect(sent[0]!.title).toContain("Asha Rao");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/lifecycle.test.ts`
Expected: FAIL — `@/server/modules/employees/lifecycle` is missing.

- [ ] **Step 3: Add `deactivateUserForExit`** — append to `src/server/modules/users/service.ts`

```ts
export type ExitLoginOutcome = "disabled" | "already_disabled" | "kept_last_super_admin" | "missing";

/** Disables a leaver's login and revokes their sessions, unless they are the last active super admin. */
export function deactivateUserForExit(db: DbLike, userId: number): ExitLoginOutcome {
  const user = getUserById(db, userId);
  if (!user) return "missing";
  if (user.status === "disabled") return "already_disabled";
  if (getUserRoles(db, userId).includes("super_admin") && otherActiveSuperAdmins(db, userId) === 0) {
    return "kept_last_super_admin";
  }
  db.update(users).set({ status: "disabled", sessionVersion: user.sessionVersion + 1 }).where(eq(users.id, userId)).run();
  return "disabled";
}
```

- [ ] **Step 4: Implement `src/server/modules/employees/lifecycle.ts`**

```ts
import { and, eq, gte, isNotNull, isNull, lt, lte } from "drizzle-orm";
import { addDays, formatDate, type ISODate } from "@/lib/dates";
import type { ResignationInput } from "@/lib/validation/employees";
import type { DbLike } from "@/server/db/client";
import { employees, notifications, type EmployeeRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { writeAudit } from "@/server/modules/audit/service";
import { notifyMany } from "@/server/modules/notifications/service";
import { activeUserIdsWithPermission, deactivateUserForExit, type ExitLoginOutcome } from "@/server/modules/users/service";
import { cancelOpenChecklists, instantiateChecklist } from "./checklists";
import { recordEmployeeEvent, requireEmployee } from "./service";

/** Resignation → `on_notice` with a `resigned` event and the offboarding checklist (spec §5.1). */
export function recordResignation(db: DbLike, actorUserId: number, employeeId: number, input: ResignationInput): EmployeeRow {
  const before = requireEmployee(db, employeeId);
  if (before.status !== "active") throw new DomainError("NOT_ACTIVE", "Only active employees can resign.");
  if (input.lastWorkingDate < input.resignationDate) {
    throw new DomainError("INVALID_DATES", "The last working day can't be before the resignation date.", {
      lastWorkingDate: ["Must be on or after the resignation date"],
    });
  }
  const after = db
    .update(employees)
    .set({
      status: "on_notice",
      resignationDate: input.resignationDate,
      lastWorkingDate: input.lastWorkingDate,
      exitReason: input.exitReason,
    })
    .where(eq(employees.id, employeeId))
    .returning()
    .get()!;
  recordEmployeeEvent(db, {
    employeeId,
    type: "resigned",
    effectiveDate: input.resignationDate,
    from: { status: "active" },
    to: { status: "on_notice", lastWorkingDate: input.lastWorkingDate },
    note: input.exitReason,
    createdBy: actorUserId,
  });
  instantiateChecklist(db, employeeId, "offboarding");
  return after;
}

/** Undo for a resignation recorded by mistake or withdrawn by the employee. */
export function withdrawResignation(db: DbLike, employeeId: number): EmployeeRow {
  const before = requireEmployee(db, employeeId);
  if (before.status !== "on_notice") throw new DomainError("NOT_ON_NOTICE", "This employee has no pending resignation.");
  const after = db
    .update(employees)
    .set({ status: "active", resignationDate: null, lastWorkingDate: null, exitReason: null })
    .where(eq(employees.id, employeeId))
    .returning()
    .get()!;
  cancelOpenChecklists(db, employeeId, "offboarding");
  return after;
}

export interface ExitOutcome {
  employeeId: number;
  employeeCode: string;
  login: ExitLoginOutcome | "none";
}

/** Exits everyone whose last working day is before `today` (so the exit lands on LWD + 1) and disables their login. */
export function processExits(db: DbLike, today: ISODate): ExitOutcome[] {
  const due = db
    .select()
    .from(employees)
    .where(and(eq(employees.status, "on_notice"), isNotNull(employees.lastWorkingDate), lt(employees.lastWorkingDate, today)))
    .all();
  return due.map((e) => {
    db.update(employees).set({ status: "exited" }).where(eq(employees.id, e.id)).run();
    recordEmployeeEvent(db, {
      employeeId: e.id,
      type: "exited",
      effectiveDate: e.lastWorkingDate!,
      from: { status: "on_notice" },
      to: { status: "exited" },
      note: e.exitReason,
      createdBy: null,
    });
    const login = e.userId === null ? "none" : deactivateUserForExit(db, e.userId);
    writeAudit(db, {
      actorUserId: null,
      action: "employee.exit",
      entityType: "employee",
      entityId: e.id,
      summary: `${e.employeeCode} exited after last working day ${e.lastWorkingDate}; login: ${login}`,
    });
    return { employeeId: e.id, employeeCode: e.employeeCode, login };
  });
}

/** Notifies HR once per employee and probation end date, when probation ends within the next 7 days. */
export function sendProbationReminders(db: DbLike, today: ISODate): number {
  const due = db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.status, "active"),
        isNull(employees.confirmationDate),
        isNotNull(employees.probationEndDate),
        gte(employees.probationEndDate, today),
        lte(employees.probationEndDate, addDays(today, 7)),
      ),
    )
    .all();
  if (due.length === 0) return 0;
  const recipients = activeUserIdsWithPermission(db, "employee.update");
  let sent = 0;
  for (const e of due) {
    const link = `/org/employees/${e.id}?tab=job`;
    const title = `Probation ends ${formatDate(e.probationEndDate!)} for ${e.displayName}`;
    const already = db
      .select({ id: notifications.id })
      .from(notifications)
      .where(and(eq(notifications.type, "employee.probation_due"), eq(notifications.link, link), eq(notifications.title, title)))
      .get();
    if (already) continue;
    notifyMany(db, recipients, { type: "employee.probation_due", title, body: "Confirm the employee or extend their probation.", link });
    sent += 1;
  }
  return sent;
}
```

- [ ] **Step 5: Create `src/server/jobs/employee-lifecycle.ts` and register it**

```ts
import { dateInTimeZone } from "@/lib/dates";
import { processExits, sendProbationReminders } from "@/server/modules/employees/lifecycle";
import type { JobDefinition } from "./registry";

export const employeeLifecycleJob: JobDefinition = {
  name: "employee:lifecycle",
  description:
    "Marks employees whose last working day has passed as exited (disabling their login) and reminds HR about probations ending within 7 days.",
  runKey: (now, timeZone) => dateInTimeZone(now, timeZone),
  run: (db, now, timeZone) => {
    const today = dateInTimeZone(now, timeZone);
    const exits = processExits(db, today);
    const reminders = sendProbationReminders(db, today);
    return `Exited ${exits.length} employee(s); sent ${reminders} probation reminder(s)`;
  },
};
```

In `src/server/jobs/registry.ts`, import it and append it to `JOBS`:

```ts
import { employeeLifecycleJob } from "./employee-lifecycle";
```

```ts
/** Every scheduled job. Later phases append their jobs here. */
export const JOBS: JobDefinition[] = [systemCleanupJob, employeeLifecycleJob];
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/integration/lifecycle.test.ts tests/integration/jobs.test.ts tests/integration/admin-routes.test.ts`
Expected: PASS. The new lifecycle tests (6) pass, and the Phase 0 job and route tests still pass with the extra registered job.

- [ ] **Step 7: Commit**

```bash
git add src/server/modules/employees/lifecycle.ts src/server/jobs src/server/modules/users/service.ts tests/integration/lifecycle.test.ts
git commit -m "feat(employees): add resignation, exit job and probation reminders"
```

Cron entry for `DEPLOY.md` (rewritten in Phase 6): `15 1 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/employee:lifecycle` (01:15 IST, spec §7).

---
### Task 10: Employee documents and their file-access rule

**Files:**
- Create: `src/server/modules/employees/documents.ts`
- Modify: `src/server/modules/files/access.ts`
- Test: `tests/integration/employee-documents.test.ts`

**Interfaces:**
- Consumes: `employeeDocuments`, `files`, `users` (schema); `requireEmployee` (Task 7); `canViewEmployee` (Task 5); `saveUpload`, `canAccessFile`.
- Produces:
  - `NewEmployeeDocument`, `addEmployeeDocument(db, input): EmployeeDocumentRow`, `getEmployeeDocument(db, id)`, `deleteEmployeeDocument(db, id): EmployeeDocumentRow`.
  - `EmployeeDocumentView`, `listEmployeeDocuments(db, employeeId): EmployeeDocumentView[]`.
  - A resolver in `files/access.ts`. It allows a file linked to an employee document for holders of `document.manage`, the employee, managers above them, and org-wide viewers (`employee.view`).

- [ ] **Step 1: Write the failing tests** — `tests/integration/employee-documents.test.ts`

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/permissions";
import type { DB } from "@/server/db/client";
import { employees, type EmployeeRow, type FileRow } from "@/server/db/schema";
import { addEmployeeDocument, deleteEmployeeDocument, listEmployeeDocuments } from "@/server/modules/employees/documents";
import { canAccessFile } from "@/server/modules/files/access";
import { saveUpload } from "@/server/modules/files/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const PDF = Buffer.from("%PDF-1.7 employee document");
let db: DB;
let dir: string;

beforeEach(() => {
  db = createTestDb();
  dir = mkdtempSync(path.join(tmpdir(), "pvcon-docs-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const upload = (uploadedBy: number | null): FileRow =>
  saveUpload(db, { data: PDF, originalName: "Offer Letter.pdf", allowed: ["pdf"], uploadedBy, uploadDir: dir });

/** A session for a new user, optionally linked to `employee`. */
function sessionAs(employee: EmployeeRow | null, roles: Role[] = ["employee"]) {
  const user = insertUser(db, { roles });
  if (employee) db.update(employees).set({ userId: user.id }).where(eq(employees.id, employee.id)).run();
  return sessionUserFor(db, user);
}

describe("employee documents", () => {
  it("adds, lists and deletes documents", () => {
    const hrUser = insertUser(db, { roles: ["hr_admin"], name: "Hari Rao" });
    const asha = insertEmployee(db);
    const file = upload(hrUser.id);
    const doc = addEmployeeDocument(db, { employeeId: asha.id, category: "offer_letter", title: "Offer letter", fileId: file.id, uploadedBy: hrUser.id });
    expect(listEmployeeDocuments(db, asha.id)).toEqual([
      {
        id: doc.id, employeeId: asha.id, fileId: file.id, category: "offer_letter", title: "Offer letter",
        originalName: "Offer Letter.pdf", size: PDF.length, mime: "application/pdf", uploadedByName: "Hari Rao", createdAt: doc.createdAt,
      },
    ]);
    expect(deleteEmployeeDocument(db, doc.id).id).toBe(doc.id);
    expect(listEmployeeDocuments(db, asha.id)).toEqual([]);
    expectDomainError(() => deleteEmployeeDocument(db, doc.id), "NOT_FOUND");
    expectDomainError(
      () => addEmployeeDocument(db, { employeeId: 9999, category: "other", title: "x", fileId: file.id, uploadedBy: null }),
      "NOT_FOUND",
    );
  });
});

describe("document file access", () => {
  it("allows the employee, managers above them, HR and org-wide viewers, but not peers", () => {
    const ceo = insertEmployee(db);
    const asha = insertEmployee(db, { reportingManagerId: ceo.id });
    const kiran = insertEmployee(db, { reportingManagerId: asha.id });
    const meera = insertEmployee(db, { reportingManagerId: ceo.id });
    const file = upload(null);
    addEmployeeDocument(db, { employeeId: kiran.id, category: "id_proof", title: "PAN card", fileId: file.id, uploadedBy: null });

    expect(canAccessFile(db, sessionAs(kiran), file)).toBe(true);
    expect(canAccessFile(db, sessionAs(asha), file)).toBe(true);
    expect(canAccessFile(db, sessionAs(ceo), file)).toBe(true);
    expect(canAccessFile(db, sessionAs(meera), file)).toBe(false);
    expect(canAccessFile(db, sessionAs(null, ["hr_admin"]), file)).toBe(true);
    expect(canAccessFile(db, sessionAs(null, ["payroll_admin"]), file)).toBe(true);
    expect(canAccessFile(db, sessionAs(null), file)).toBe(false);
  });

  it("gives nothing extra for files that are not employee documents", () => {
    const loose = upload(null);
    expect(canAccessFile(db, sessionAs(insertEmployee(db)), loose)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/employee-documents.test.ts`
Expected: FAIL — `@/server/modules/employees/documents` is missing.

- [ ] **Step 3: Implement `src/server/modules/employees/documents.ts`**

```ts
import { desc, eq } from "drizzle-orm";
import type { DocumentCategory } from "@/lib/hr";
import type { DbLike } from "@/server/db/client";
import { employeeDocuments, files, users, type EmployeeDocumentRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { requireEmployee } from "./service";

export interface NewEmployeeDocument {
  employeeId: number;
  category: DocumentCategory;
  title: string;
  fileId: number;
  uploadedBy: number | null;
}

export interface EmployeeDocumentView {
  id: number;
  employeeId: number;
  fileId: number;
  category: DocumentCategory;
  title: string;
  originalName: string;
  size: number;
  mime: string;
  uploadedByName: string | null;
  createdAt: string;
}

export function addEmployeeDocument(db: DbLike, input: NewEmployeeDocument): EmployeeDocumentRow {
  requireEmployee(db, input.employeeId);
  return db.insert(employeeDocuments).values(input).returning().get();
}

export function getEmployeeDocument(db: DbLike, id: number): EmployeeDocumentRow | undefined {
  return db.select().from(employeeDocuments).where(eq(employeeDocuments.id, id)).get();
}

/** Removes the document record; the stored file stays (readable only by its uploader and super admins). */
export function deleteEmployeeDocument(db: DbLike, id: number): EmployeeDocumentRow {
  const doc = getEmployeeDocument(db, id);
  if (!doc) throw new DomainError("NOT_FOUND", "Document not found.");
  db.delete(employeeDocuments).where(eq(employeeDocuments.id, id)).run();
  return doc;
}

export function listEmployeeDocuments(db: DbLike, employeeId: number): EmployeeDocumentView[] {
  return db
    .select({
      id: employeeDocuments.id,
      employeeId: employeeDocuments.employeeId,
      fileId: employeeDocuments.fileId,
      category: employeeDocuments.category,
      title: employeeDocuments.title,
      originalName: files.originalName,
      size: files.size,
      mime: files.mime,
      uploadedByName: users.name,
      createdAt: employeeDocuments.createdAt,
    })
    .from(employeeDocuments)
    .innerJoin(files, eq(files.id, employeeDocuments.fileId))
    .leftJoin(users, eq(users.id, employeeDocuments.uploadedBy))
    .where(eq(employeeDocuments.employeeId, employeeId))
    .orderBy(desc(employeeDocuments.createdAt), desc(employeeDocuments.id))
    .all();
}
```

- [ ] **Step 4: Add the resolver** — replace `src/server/modules/files/access.ts`

```ts
import { eq } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DbLike } from "@/server/db/client";
import { employeeDocuments, type FileRow } from "@/server/db/schema";
import { canViewEmployee } from "@/server/modules/employees/scope";
import { getSetting } from "@/server/modules/settings/service";

export type FileAccessResolver = (db: DbLike, user: SessionUser, file: FileRow) => boolean;

/**
 * A file is readable when any resolver allows it.
 * Later phases append resolvers here (payslips, receipts, …).
 */
const RESOLVERS: FileAccessResolver[] = [
  (_db, user, file) => file.uploadedBy === user.id,
  (_db, user) => user.roles.includes("super_admin"),
  (db, _user, file) => getSetting(db, "company").logoFileId === file.id,
  // Employee documents: HR (`document.manage`), the employee, managers above them, org-wide viewers.
  (db, user, file) => {
    const doc = db
      .select({ employeeId: employeeDocuments.employeeId })
      .from(employeeDocuments)
      .where(eq(employeeDocuments.fileId, file.id))
      .get();
    return !!doc && (can(user, "document.manage") || canViewEmployee(db, user, doc.employeeId));
  },
];

export function canAccessFile(db: DbLike, user: SessionUser, file: FileRow): boolean {
  return RESOLVERS.some((resolve) => resolve(db, user, file));
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/integration/employee-documents.test.ts tests/integration/files.test.ts tests/integration/admin-routes.test.ts`
Expected: PASS. The new tests (3) pass and the Phase 0 file-access tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/modules/employees/documents.ts src/server/modules/files/access.ts tests/integration/employee-documents.test.ts
git commit -m "feat(employees): add employee documents and their file access rule"
```

---

### Task 11: Bank and ID change requests

**Files:**
- Create: `src/server/modules/employees/profile-changes.ts`
- Test: `tests/integration/profile-changes.test.ts`

**Interfaces:**
- Consumes:
  - `profileChangeRequests`, `employees` (schema); `sealBank`/`openBank`/`bankView` (Task 4); `requireEmployee`, `updateEmployeeBank` (Task 7).
  - `activeUserIdsWithPermission` (Task 5); `notify`, `notifyMany`; `BankInput` (Task 1).
- Produces:
  - `pendingProfileChangeFor(db, employeeId): ProfileChangeRequestRow | undefined`.
  - `submitProfileChange(db, employeeId, requestedBy, input: BankInput, reason): ProfileChangeRequestRow` (errors `EMPLOYEE_EXITED`, `NOTHING_TO_CHANGE`, `PENDING_EXISTS`).
  - `withdrawProfileChange(db, employeeId, requestId): ProfileChangeRequestRow` (errors `NOT_FOUND`, `NOT_PENDING`).
  - `decideProfileChange(db, approverUserId, requestId, decision: "approved" | "rejected", note): { request; before: BankView; after: BankView }` (errors `NOT_PENDING`, `SELF_APPROVAL`).
  - `PendingProfileChange`, `listPendingProfileChanges(db, reveal: boolean): PendingProfileChange[]`.
- Behaviour: a request carries only the values the employee typed. Blank means "keep the current value" (spec §5.1: bank/ID changes need HR approval). Employees only ever see their own values masked, so they cannot re-type the full set.

- [ ] **Step 1: Write the failing tests** — `tests/integration/profile-changes.test.ts`

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { BankInput } from "@/lib/validation/employees";
import type { DB } from "@/server/db/client";
import { employees, notifications, type EmployeeRow, type UserRow } from "@/server/db/schema";
import {
  decideProfileChange, listPendingProfileChanges, pendingProfileChangeFor, submitProfileChange, withdrawProfileChange,
} from "@/server/modules/employees/profile-changes";
import { openBank } from "@/server/modules/employees/sensitive";
import { createEmployee } from "@/server/modules/employees/service";
import { createTestDb } from "../helpers/db";
import { employeeInput } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const change = (patch: Partial<BankInput> = {}): BankInput => ({
  bankName: null, bankAccount: null, bankIfsc: null, pan: null, aadhaar: null, passport: null, ...patch,
});
const newAccount = change({ bankName: "HDFC Bank", bankAccount: "444455556666", bankIfsc: "HDFC0001234" });

let db: DB;
let hrUser: UserRow;
let hr: SessionUser;
let ashaUser: UserRow;
let asha: EmployeeRow;
const employeeRow = (id: number) => db.select().from(employees).where(eq(employees.id, id)).get()!;

beforeEach(() => {
  db = createTestDb();
  hrUser = insertUser(db, { roles: ["hr_admin"] });
  hr = sessionUserFor(db, hrUser);
  ashaUser = insertUser(db, { roles: ["employee"] });
  asha = createEmployee(
    db, hr,
    employeeInput({ bankName: "SBI", bankAccount: "111122223333", bankIfsc: "SBIN0000001", pan: "ABCDE1234F" }),
    { login: { mode: "link", userId: ashaUser.id }, onboarding: false },
  );
});

describe("submitting", () => {
  it("stores requested values encrypted and notifies HR, not the requester", () => {
    const request = submitProfileChange(db, asha.id, ashaUser.id, newAccount, "New salary account");
    expect(JSON.stringify(request)).not.toContain("444455556666");
    expect(request).toMatchObject({ status: "pending", reason: "New salary account", requestedBy: ashaUser.id });
    expect(db.select().from(notifications).all().map((n) => [n.userId, n.type, n.link])).toEqual([
      [hrUser.id, "profile_change.submitted", "/approvals"],
    ]);
  });

  it("needs at least one value and allows one pending request at a time", () => {
    expectDomainError(() => submitProfileChange(db, asha.id, ashaUser.id, change(), null), "NOTHING_TO_CHANGE");
    submitProfileChange(db, asha.id, ashaUser.id, change({ bankIfsc: "HDFC0001234" }), null);
    expectDomainError(() => submitProfileChange(db, asha.id, ashaUser.id, change({ bankIfsc: "ICIC0001234" }), null), "PENDING_EXISTS");
  });

  it("lets the employee withdraw only their own pending request", () => {
    const request = submitProfileChange(db, asha.id, ashaUser.id, newAccount, null);
    const other = createEmployee(db, hr, employeeInput({ firstName: "Ravi" }), { login: { mode: "none" }, onboarding: false });
    expectDomainError(() => withdrawProfileChange(db, other.id, request.id), "NOT_FOUND");
    expect(withdrawProfileChange(db, asha.id, request.id).status).toBe("withdrawn");
    expect(pendingProfileChangeFor(db, asha.id)).toBeUndefined();
    expectDomainError(() => withdrawProfileChange(db, asha.id, request.id), "NOT_PENDING");
  });
});

describe("deciding", () => {
  it("applies only the provided values on approval and tells the employee", () => {
    const request = submitProfileChange(db, asha.id, ashaUser.id, newAccount, null);
    const result = decideProfileChange(db, hrUser.id, request.id, "approved", "Verified the cancelled cheque");
    expect(result.request).toMatchObject({ status: "approved", approverId: hrUser.id, note: "Verified the cancelled cheque" });
    expect([result.before.bankAccount, result.after.bankAccount]).toEqual(["XXXX3333", "XXXX6666"]);
    expect(openBank(employeeRow(asha.id))).toEqual({
      bankName: "HDFC Bank", bankAccount: "444455556666", bankIfsc: "HDFC0001234", pan: "ABCDE1234F", aadhaar: null, passport: null,
    });
    const toAsha = db.select().from(notifications).where(eq(notifications.userId, ashaUser.id)).all();
    expect(toAsha.map((n) => [n.type, n.link])).toEqual([["profile_change.approved", "/me/profile"]]);
    expectDomainError(() => decideProfileChange(db, hrUser.id, request.id, "rejected", null), "NOT_PENDING");
  });

  it("leaves bank details untouched on rejection", () => {
    const request = submitProfileChange(db, asha.id, ashaUser.id, newAccount, null);
    expect(decideProfileChange(db, hrUser.id, request.id, "rejected", "Name mismatch").request.status).toBe("rejected");
    expect(openBank(employeeRow(asha.id)).bankAccount).toBe("111122223333");
  });

  it("refuses to let people decide their own request", () => {
    const hari = createEmployee(db, hr, employeeInput({ firstName: "Hari" }), { login: { mode: "link", userId: hrUser.id }, onboarding: false });
    const request = submitProfileChange(db, hari.id, hrUser.id, change({ bankIfsc: "HDFC0001234" }), null);
    expectDomainError(() => decideProfileChange(db, hrUser.id, request.id, "approved", null), "SELF_APPROVAL");
  });
});

describe("listPendingProfileChanges", () => {
  it("masks current and requested values unless revealed", () => {
    submitProfileChange(db, asha.id, ashaUser.id, newAccount, null);
    const [masked] = listPendingProfileChanges(db, false);
    expect(masked).toMatchObject({
      employeeName: "Asha Rao",
      current: { bankAccount: "XXXX3333", pan: "XXXX234F" },
      requested: { bankAccount: "XXXX6666", pan: null },
    });
    expect(JSON.stringify(masked)).not.toMatch(/444455556666|111122223333|Enc/);
    expect(listPendingProfileChanges(db, true)[0]!.requested.bankAccount).toBe("444455556666");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/profile-changes.test.ts`
Expected: FAIL — `@/server/modules/employees/profile-changes` is missing.

- [ ] **Step 3: Implement `src/server/modules/employees/profile-changes.ts`**

```ts
import { and, asc, eq } from "drizzle-orm";
import type { BankInput } from "@/lib/validation/employees";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import { employees, profileChangeRequests, type ProfileChangeRequestRow } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { notify, notifyMany } from "@/server/modules/notifications/service";
import { activeUserIdsWithPermission } from "@/server/modules/users/service";
import { bankView, openBank, sealBank, type BankView } from "./sensitive";
import { requireEmployee, updateEmployeeBank } from "./service";

/** Blank requested values keep the employee's current value. */
function mergeBank(current: BankInput, requested: BankInput): BankInput {
  return {
    bankName: requested.bankName ?? current.bankName,
    bankAccount: requested.bankAccount ?? current.bankAccount,
    bankIfsc: requested.bankIfsc ?? current.bankIfsc,
    pan: requested.pan ?? current.pan,
    aadhaar: requested.aadhaar ?? current.aadhaar,
    passport: requested.passport ?? current.passport,
  };
}

function requireRequest(db: DbLike, id: number): ProfileChangeRequestRow {
  const row = db.select().from(profileChangeRequests).where(eq(profileChangeRequests.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Change request not found.");
  return row;
}

export function pendingProfileChangeFor(db: DbLike, employeeId: number): ProfileChangeRequestRow | undefined {
  return db
    .select()
    .from(profileChangeRequests)
    .where(and(eq(profileChangeRequests.employeeId, employeeId), eq(profileChangeRequests.status, "pending")))
    .get();
}

export function submitProfileChange(
  db: DbLike,
  employeeId: number,
  requestedBy: number,
  input: BankInput,
  reason: string | null,
): ProfileChangeRequestRow {
  const employee = requireEmployee(db, employeeId);
  if (employee.status === "exited") throw new DomainError("EMPLOYEE_EXITED", "Exited employees can't request changes.");
  if (Object.values(input).every((value) => value === null)) {
    throw new DomainError("NOTHING_TO_CHANGE", "Enter at least one new value.");
  }
  if (pendingProfileChangeFor(db, employeeId)) {
    throw new DomainError("PENDING_EXISTS", "You already have a pending change request. Withdraw it before sending another.");
  }
  const request = db
    .insert(profileChangeRequests)
    .values({ employeeId, fields: sealBank(input), reason, requestedBy })
    .returning()
    .get();
  const recipients = activeUserIdsWithPermission(db, "employee.update").filter((id) => id !== requestedBy);
  notifyMany(db, recipients, {
    type: "profile_change.submitted",
    title: `${employee.displayName} asked to change their bank details`,
    body: reason,
    link: "/approvals",
  });
  return request;
}

export function withdrawProfileChange(db: DbLike, employeeId: number, requestId: number): ProfileChangeRequestRow {
  const request = requireRequest(db, requestId);
  if (request.employeeId !== employeeId) throw new DomainError("NOT_FOUND", "Change request not found.");
  if (request.status !== "pending") throw new DomainError("NOT_PENDING", "This request is no longer pending.");
  return db
    .update(profileChangeRequests)
    .set({ status: "withdrawn", decidedAt: nowIso() })
    .where(eq(profileChangeRequests.id, requestId))
    .returning()
    .get()!;
}

/** Maker-checker: nobody decides a request for their own employee record or one they raised. */
export function decideProfileChange(
  db: DbLike,
  approverUserId: number,
  requestId: number,
  decision: "approved" | "rejected",
  note: string | null,
): { request: ProfileChangeRequestRow; before: BankView; after: BankView } {
  const request = requireRequest(db, requestId);
  if (request.status !== "pending") throw new DomainError("NOT_PENDING", "This request is no longer pending.");
  const employee = requireEmployee(db, request.employeeId);
  if (request.requestedBy === approverUserId || employee.userId === approverUserId) {
    throw new DomainError("SELF_APPROVAL", "Someone else has to decide on your own change request.");
  }
  let before = bankView(employee, false);
  let after = before;
  if (decision === "approved") {
    ({ before, after } = updateEmployeeBank(db, employee.id, mergeBank(openBank(employee), openBank(request.fields))));
  }
  const decided = db
    .update(profileChangeRequests)
    .set({ status: decision, approverId: approverUserId, decidedAt: nowIso(), note })
    .where(eq(profileChangeRequests.id, requestId))
    .returning()
    .get()!;
  if (employee.userId !== null) {
    notify(db, {
      userId: employee.userId,
      type: `profile_change.${decision}`,
      title: decision === "approved" ? "Your bank details change was approved" : "Your bank details change was rejected",
      body: note,
      link: "/me/profile",
    });
  }
  return { request: decided, before, after };
}

export interface PendingProfileChange {
  id: number;
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  reason: string | null;
  createdAt: string;
  current: BankView;
  /** Values the employee typed; null means "keep the current value". */
  requested: BankView;
}

/** Pass `reveal: true` only for viewers with `employee.sensitive.view`. */
export function listPendingProfileChanges(db: DbLike, reveal: boolean): PendingProfileChange[] {
  return db
    .select({ request: profileChangeRequests, employee: employees })
    .from(profileChangeRequests)
    .innerJoin(employees, eq(employees.id, profileChangeRequests.employeeId))
    .where(eq(profileChangeRequests.status, "pending"))
    .orderBy(asc(profileChangeRequests.createdAt), asc(profileChangeRequests.id))
    .all()
    .map(({ request, employee }) => ({
      id: request.id,
      employeeId: employee.id,
      employeeCode: employee.employeeCode,
      employeeName: employee.displayName,
      reason: request.reason,
      createdAt: request.createdAt,
      current: bankView(employee, reveal),
      requested: bankView(request.fields, reveal),
    }));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/integration/profile-changes.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/modules/employees/profile-changes.ts tests/integration/profile-changes.test.ts
git commit -m "feat(employees): add HR-approved bank and ID change requests"
```

---

### Task 12: CSV bulk import

**Files:**
- Modify: `package.json`, `package-lock.json` (add `papaparse`, `@types/papaparse`)
- Create: `src/lib/validation/employee-import.ts`, `src/server/modules/employees/import.ts`
- Test: `tests/integration/employee-import.test.ts`

**Interfaces:**
- Consumes: `createEmployee`, `NewEmployee` (Task 7); `optionalText`, `optionalEmail`, `optionalPhone`, `optionalDate`, `isoDate` (Task 1); `GENDERS`, `EMPLOYMENT_TYPES` (Task 1).
- Produces:
  - `src/lib/validation/employee-import.ts`: `IMPORT_COLUMNS`, `ImportColumn`, `REQUIRED_IMPORT_COLUMNS`, `MAX_IMPORT_ROWS` (500), `IMPORT_TEMPLATE_CSV`, `importRowSchema`.
  - `src/server/modules/employees/import.ts`: `ImportRowResult` (`{ row, employeeCode, name, workEmail, errors }`), `ImportPreview` (`{ rows, valid, invalid, fileErrors }`), `previewEmployeeImport(db, csv): ImportPreview`, `commitEmployeeImport(db, actor, csv): { created: number; codes: string[] }` (all-or-nothing, error `IMPORT_INVALID`).
- Behaviour:
  - Imports create employee records only: no logins and no onboarding checklists. Logins are added later from the profile page (Task 15).
  - Managers are matched by `manager_email`, against a current employee or an earlier row of the same file.

- [ ] **Step 1: Install papaparse**

Run: `npm install papaparse@^5.5.3 && npm install -D @types/papaparse@^5.5.2`
Expected: both appear in `package.json`, and `npm ls papaparse` shows one version.

- [ ] **Step 2: Write the failing tests** — `tests/integration/employee-import.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { employees } from "@/server/db/schema";
import { listEmployeeChecklists, seedDefaultChecklistTemplates } from "@/server/modules/employees/checklists";
import { commitEmployeeImport, previewEmployeeImport } from "@/server/modules/employees/import";
import { createTestDb } from "../helpers/db";
import { insertDepartment, insertDesignation, insertEmployee } from "../helpers/employees";
import { expectDomainError, insertUser, sessionUserFor } from "../helpers/fixtures";

const HEADER = " First_Name ,LAST_NAME,work_email,department,designation,manager_email,date_of_joining,employee_code";
const csv = (...rows: string[]) => [HEADER, ...rows].join("\n") + "\n";

let db: DB;
let hr: SessionUser;
beforeEach(() => {
  db = createTestDb();
  hr = sessionUserFor(db, insertUser(db, { roles: ["hr_admin"] }));
  insertDepartment(db, "Engineering");
  insertDesignation(db, "Consultant");
});

describe("previewEmployeeImport", () => {
  it("reads a BOM, Windows line endings, messy headers and trailing blank lines", () => {
    const file = "﻿" + [
      HEADER,
      "Asha,Rao,Asha@PVCON.in,engineering,consultant,,2026-10-01,",
      "Ravi,Menon,ravi@pvcon.in,Engineering,,asha@pvcon.in,2026-10-05,",
      ",,,,,,,",
      "",
    ].join("\r\n");
    expect(previewEmployeeImport(db, file)).toEqual({
      rows: [
        { row: 1, employeeCode: null, name: "Asha Rao", workEmail: "asha@pvcon.in", errors: [] },
        { row: 2, employeeCode: null, name: "Ravi Menon", workEmail: "ravi@pvcon.in", errors: [] },
      ],
      valid: 2,
      invalid: 0,
      fileErrors: [],
    });
  });

  it("reports every problem, row by row", () => {
    insertEmployee(db, { workEmail: "taken@pvcon.in", employeeCode: "PV0009" });
    const preview = previewEmployeeImport(db, csv(
      "Asha,Rao,asha@pvcon.in,Sales,,,2026-10-01,",
      "Ravi,Menon,asha@pvcon.in,,,,2026-10-05,",
      "Kiran,Das,kiran@pvcon.in,,,meera@pvcon.in,2026-10-05,",
      "Meera,Iyer,meera@pvcon.in,,,,2026-10-05,PV0009",
      ",Nobody,,,,,2026-02-30,",
      "Taken,Person,taken@pvcon.in,,,,2026-10-05,",
    ));
    expect(preview.rows.map((r) => r.errors)).toEqual([
      ['department: no active department called "Sales"'],
      ["work_email: repeats row 1"],
      ["manager_email: no current employee with this work email (a new manager must be on an earlier row)"],
      ["employee_code: PV0009 already exists"],
      ["first_name: is required", "date_of_joining: Enter a valid date"],
      ["work_email: taken@pvcon.in already belongs to an employee"],
    ]);
    expect([preview.valid, preview.invalid]).toEqual([0, 6]);
  });

  it("rejects files with missing or unknown columns, no data, or too many rows", () => {
    expect(previewEmployeeImport(db, "last_name,work_email\nRao,a@pvcon.in\n").fileErrors).toEqual([
      "Missing required column(s): first_name, date_of_joining.",
    ]);
    expect(previewEmployeeImport(db, "first_name,date_of_joining,salary\nAsha,2026-10-01,100\n").fileErrors).toEqual([
      "Unknown column(s): salary. Use the template's column names.",
    ]);
    expect(previewEmployeeImport(db, "first_name,date_of_joining\n").fileErrors).toEqual(["The file has no data rows."]);
    const many = ["first_name,date_of_joining", ...Array.from({ length: 501 }, (_, i) => `E${i},2026-10-01`)].join("\n");
    expect(previewEmployeeImport(db, many).fileErrors).toEqual(["Import at most 500 rows at a time."]);
  });
});

describe("commitEmployeeImport", () => {
  it("creates every row in order, linking managers from earlier rows and generating codes", () => {
    seedDefaultChecklistTemplates(db);
    const result = commitEmployeeImport(db, hr, csv(
      "Asha,Rao,asha@pvcon.in,Engineering,Consultant,,2026-10-01,",
      "Ravi,Menon,ravi@pvcon.in,Engineering,,asha@pvcon.in,2026-10-05,",
      "Meera,Iyer,meera@pvcon.in,,,,2026-10-05,PV0050",
    ));
    expect(result).toEqual({ created: 3, codes: ["PV0001", "PV0002", "PV0050"] });
    const rows = db.select().from(employees).all();
    const asha = rows.find((e) => e.workEmail === "asha@pvcon.in")!;
    expect(rows.find((e) => e.workEmail === "ravi@pvcon.in")!.reportingManagerId).toBe(asha.id);
    expect(listEmployeeChecklists(db, asha.id)).toEqual([]);
  });

  it("creates nothing when any row is invalid", () => {
    expectDomainError(() => commitEmployeeImport(db, hr, csv("Asha,Rao,asha@pvcon.in,Sales,,,2026-10-01,")), "IMPORT_INVALID");
    expect(db.select().from(employees).all()).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/integration/employee-import.test.ts`
Expected: FAIL — `@/server/modules/employees/import` is missing.

- [ ] **Step 4: Create `src/lib/validation/employee-import.ts`**

```ts
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
```

- [ ] **Step 5: Implement `src/server/modules/employees/import.ts`**

```ts
import { eq } from "drizzle-orm";
import Papa from "papaparse";
import type { SessionUser } from "@/lib/auth/types";
import {
  IMPORT_COLUMNS, MAX_IMPORT_ROWS, REQUIRED_IMPORT_COLUMNS, importRowSchema,
} from "@/lib/validation/employee-import";
import type { DbLike } from "@/server/db/client";
import { departments, designations, employees } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createEmployee, type NewEmployee } from "./service";

export interface ImportRowResult {
  row: number;
  employeeCode: string | null;
  name: string;
  workEmail: string | null;
  errors: string[];
}

export interface ImportPreview {
  rows: ImportRowResult[];
  valid: number;
  invalid: number;
  fileErrors: string[];
}

interface CheckedRow extends ImportRowResult {
  input: NewEmployee | null;
  managerEmail: string | null;
}

function nameIndex(rows: { id: number; name: string }[]): Map<string, number> {
  return new Map(rows.map((r) => [r.name.toLowerCase(), r.id]));
}

function checkFile(db: DbLike, csv: string): { rows: CheckedRow[]; fileErrors: string[] } {
  const parsed = Papa.parse<Record<string, string>>(csv.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase(),
  });
  const headers = parsed.meta.fields ?? [];
  const fileErrors: string[] = [];
  const missing = REQUIRED_IMPORT_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length) fileErrors.push(`Missing required column(s): ${missing.join(", ")}.`);
  const unknown = headers.filter((header) => !(IMPORT_COLUMNS as readonly string[]).includes(header));
  if (unknown.length) fileErrors.push(`Unknown column(s): ${unknown.join(", ")}. Use the template's column names.`);
  if (parsed.data.length === 0) fileErrors.push("The file has no data rows.");
  if (parsed.data.length > MAX_IMPORT_ROWS) fileErrors.push(`Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
  if (fileErrors.length) return { rows: [], fileErrors };

  const departmentIds = nameIndex(
    db.select({ id: departments.id, name: departments.name }).from(departments).where(eq(departments.archived, false)).all(),
  );
  const designationIds = nameIndex(
    db.select({ id: designations.id, name: designations.name }).from(designations).where(eq(designations.archived, false)).all(),
  );
  const existing = db
    .select({ code: employees.employeeCode, workEmail: employees.workEmail, status: employees.status })
    .from(employees)
    .all();
  const takenCodes = new Set(existing.map((e) => e.code));
  const takenEmails = new Set(existing.flatMap((e) => (e.workEmail ? [e.workEmail] : [])));
  const currentEmails = new Set(existing.flatMap((e) => (e.workEmail && e.status !== "exited" ? [e.workEmail] : [])));
  const codesInFile = new Map<string, number>();
  const emailsInFile = new Map<string, number>();

  const rows = parsed.data.map((raw, index): CheckedRow => {
    const row = index + 1;
    const values = Object.fromEntries(IMPORT_COLUMNS.map((column) => [column, raw[column] ?? ""]));
    const name = [(raw.first_name ?? "").trim(), (raw.last_name ?? "").trim()].filter(Boolean).join(" ") || `Row ${row}`;
    const result = importRowSchema.safeParse(values);
    if (!result.success) {
      const errors = result.error.issues.map((issue) => `${String(issue.path[0])}: ${issue.message}`);
      return { row, employeeCode: null, name, workEmail: null, errors, input: null, managerEmail: null };
    }
    const r = result.data;
    const errors: string[] = [];
    if (r.employee_code) {
      if (takenCodes.has(r.employee_code)) errors.push(`employee_code: ${r.employee_code} already exists`);
      else if (codesInFile.has(r.employee_code)) errors.push(`employee_code: repeats row ${codesInFile.get(r.employee_code)}`);
      else codesInFile.set(r.employee_code, row);
    }
    if (r.work_email) {
      if (takenEmails.has(r.work_email)) errors.push(`work_email: ${r.work_email} already belongs to an employee`);
      else if (emailsInFile.has(r.work_email)) errors.push(`work_email: repeats row ${emailsInFile.get(r.work_email)}`);
      else emailsInFile.set(r.work_email, row);
    }
    const departmentId = r.department ? departmentIds.get(r.department.toLowerCase()) : undefined;
    if (r.department && departmentId === undefined) errors.push(`department: no active department called "${r.department}"`);
    const designationId = r.designation ? designationIds.get(r.designation.toLowerCase()) : undefined;
    if (r.designation && designationId === undefined) errors.push(`designation: no active designation called "${r.designation}"`);
    if (r.manager_email) {
      const earlierRow = emailsInFile.get(r.manager_email);
      if (!currentEmails.has(r.manager_email) && !(earlierRow !== undefined && earlierRow < row)) {
        errors.push("manager_email: no current employee with this work email (a new manager must be on an earlier row)");
      }
    }
    if (r.probation_end_date && r.probation_end_date < r.date_of_joining) {
      errors.push("probation_end_date: must be on or after date_of_joining");
    }
    const input: NewEmployee = {
      firstName: r.first_name, lastName: r.last_name, displayName: null,
      workEmail: r.work_email, personalEmail: r.personal_email, phone: r.phone,
      dateOfBirth: r.date_of_birth, gender: r.gender, maritalStatus: null, address: null, emergencyContact: null,
      departmentId: departmentId ?? null, designationId: designationId ?? null, reportingManagerId: null,
      employmentType: r.employment_type, workLocation: r.work_location, dateOfJoining: r.date_of_joining,
      probationEndDate: r.probation_end_date, confirmationDate: null, noticePeriodDays: r.notice_period_days,
      bankName: null, bankAccount: null, bankIfsc: null, pan: null, aadhaar: null, passport: null,
      employeeCode: r.employee_code,
    };
    return {
      row, employeeCode: r.employee_code, name, workEmail: r.work_email, errors,
      input: errors.length ? null : input, managerEmail: r.manager_email,
    };
  });
  return { rows, fileErrors };
}

export function previewEmployeeImport(db: DbLike, csv: string): ImportPreview {
  const { rows, fileErrors } = checkFile(db, csv);
  const results = rows.map((r) => ({ row: r.row, employeeCode: r.employeeCode, name: r.name, workEmail: r.workEmail, errors: r.errors }));
  const invalid = results.filter((r) => r.errors.length > 0).length;
  return { rows: results, valid: results.length - invalid, invalid, fileErrors };
}

/** All-or-nothing: call inside one transaction (the server action's). */
export function commitEmployeeImport(db: DbLike, actor: SessionUser, csv: string): { created: number; codes: string[] } {
  const { rows, fileErrors } = checkFile(db, csv);
  if (fileErrors.length > 0 || rows.some((r) => r.errors.length > 0)) {
    throw new DomainError("IMPORT_INVALID", "Fix the errors shown in the preview, then import again.");
  }
  const idByEmail = new Map<string, number>();
  for (const e of db.select({ id: employees.id, workEmail: employees.workEmail }).from(employees).all()) {
    if (e.workEmail) idByEmail.set(e.workEmail, e.id);
  }
  const codes: string[] = [];
  for (const row of rows) {
    const reportingManagerId = row.managerEmail ? (idByEmail.get(row.managerEmail) ?? null) : null;
    const created = createEmployee(db, actor, { ...row.input!, reportingManagerId }, { login: { mode: "none" }, onboarding: false });
    if (created.workEmail) idByEmail.set(created.workEmail, created.id);
    codes.push(created.employeeCode);
  }
  return { created: codes.length, codes };
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/integration/employee-import.test.ts && npm run typecheck`
Expected: PASS (5 tests), and typecheck is clean.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/validation/employee-import.ts src/server/modules/employees/import.ts tests/integration/employee-import.test.ts
git commit -m "feat(employees): add CSV bulk import with dry-run preview"
```

---
### Task 13: Navigation and org-master pages (departments, designations, checklist templates)

**Files:**
- Modify: `src/components/shell/nav.ts`, `src/components/shell/sidebar-nav.tsx`, `src/components/shell/command-palette.tsx`, `src/components/shell/app-shell.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `tests/unit/shell/nav.test.ts`
- Create: `src/components/forms/select-values.ts`
- Create: `src/app/(app)/org/departments/{page,actions,departments-client}.tsx`, `src/app/(app)/org/designations/{page,actions,designations-client}.tsx`, `src/app/(app)/org/checklists/{page,actions,templates-client}.tsx` (every `actions` file is `.ts`)
- Test: `tests/unit/components/select-values.test.ts`, `tests/integration/org-actions.test.ts`

**Interfaces:**
- Consumes: org services/queries (Task 3), checklist services (Task 6), `employeeOptions` (Task 8), validation (Task 1), `defineAction`, `diffObjects`, UI primitives.
- Produces:
  - `NavItem.requiresEmployee?: boolean`; `visibleNav(permissions, opts?: { hasEmployee?: boolean })`.
  - Nav groups: Home (+ Approvals), My Space, Organization, Settings (+ Employee codes).
  - `AppShell` `user.hasEmployee`; `idOrNull`, `textOrNull` (`select-values.ts`).
  - Actions: `createDepartmentAction`, `updateDepartmentAction`, `archiveDepartmentAction`, `createDesignationAction`, `updateDesignationAction`, `archiveDesignationAction`, `createChecklistTemplateAction`, `updateChecklistTemplateAction`, `archiveChecklistTemplateAction`.
  - Pages `/org/departments`, `/org/designations` (`org.manage`) and `/org/checklists` (`employee.update`).

- [ ] **Step 1: Write the failing tests**

Replace `tests/unit/shell/nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { permissionsForRoles } from "@/lib/auth/permissions";
import { isActivePath, visibleNav } from "@/components/shell/nav";

const hrefs = (roles: Parameters<typeof permissionsForRoles>[0], hasEmployee = false) =>
  visibleNav(permissionsForRoles(roles), { hasEmployee }).flatMap((g) => g.items.map((i) => i.href));

describe("navigation", () => {
  it("shows employees home and the directory, and My Space once linked to an employee record", () => {
    const employee = permissionsForRoles(["employee"]);
    expect(visibleNav(employee).map((g) => g.title)).toEqual(["Home", "Organization"]);
    expect(visibleNav(employee, { hasEmployee: true }).map((g) => g.title)).toEqual(["Home", "My Space", "Organization"]);
    expect(hrefs(["employee"])).toEqual(["/", "/notifications", "/org/directory", "/org/chart"]);
  });

  it("shows HR the org masters, approvals and users, but not company settings or jobs", () => {
    const items = hrefs(["hr_admin"]);
    expect(items).toEqual(
      expect.arrayContaining(["/approvals", "/org/employees", "/org/departments", "/org/checklists", "/org/import", "/settings/users"]),
    );
    expect(items).not.toContain("/settings/company");
    expect(items).not.toContain("/settings/jobs");
  });

  it("shows super admins every settings page", () => {
    expect(hrefs(["super_admin"])).toEqual(
      expect.arrayContaining([
        "/settings/company", "/settings/employee", "/settings/users", "/settings/security", "/settings/audit", "/settings/jobs",
      ]),
    );
  });

  it("matches active paths by segment", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/settings/users", "/")).toBe(false);
    expect(isActivePath("/settings/users/5", "/settings/users")).toBe(true);
    expect(isActivePath("/settings/usersx", "/settings/users")).toBe(false);
  });
});
```

`tests/unit/components/select-values.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { idOrNull, textOrNull } from "@/components/forms/select-values";

describe("select value converters", () => {
  it("turns empty select values into null and ids into numbers", () => {
    expect(idOrNull("")).toBeNull();
    expect(idOrNull(null)).toBeNull();
    expect(idOrNull("12")).toBe(12);
    expect(idOrNull(7)).toBe(7);
    expect(textOrNull("")).toBeNull();
    expect(textOrNull("female")).toBe("female");
  });
});
```

`tests/integration/org-actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

// Only the Next.js runtime boundary is replaced; actions, services and the DB are real.
const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import {
  archiveChecklistTemplateAction, createChecklistTemplateAction, updateChecklistTemplateAction,
} from "@/app/(app)/org/checklists/actions";
import { archiveDepartmentAction, createDepartmentAction, updateDepartmentAction } from "@/app/(app)/org/departments/actions";
import { archiveDesignationAction, createDesignationAction, updateDesignationAction } from "@/app/(app)/org/designations/actions";

const dept = (name: string) => ({ name, code: null, parentId: null, headEmployeeId: null });
let hr: SessionUser;
let employee: SessionUser;
const audits = () => state.db.select().from(auditLogs).all().map((a) => a.action);

beforeEach(() => {
  state.db = createTestDb();
  hr = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
  employee = sessionUserFor(state.db, insertUser(state.db, { roles: ["employee"] }));
  state.user = hr;
});

describe("department actions", () => {
  it("create, update and archive, each audited", async () => {
    const created = await createDepartmentAction({ ...dept("Engineering"), code: "eng" });
    if (!created.ok) throw new Error(created.error);
    await expect(updateDepartmentAction({ ...dept("Engineering & IT"), id: created.data.id })).resolves.toMatchObject({ ok: true });
    await expect(archiveDepartmentAction({ id: created.data.id, archived: true })).resolves.toEqual({ ok: true, data: { archived: true } });
    expect(audits()).toEqual(["department.create", "department.update", "department.archive"]);
  });

  it("returns duplicates as field errors, explains blocked archiving and refuses people without org.manage", async () => {
    const created = await createDepartmentAction(dept("Engineering"));
    if (!created.ok) throw new Error(created.error);
    await expect(createDepartmentAction(dept("engineering"))).resolves.toMatchObject({
      ok: false, code: "DUPLICATE_NAME", fieldErrors: { name: ["Already exists"] },
    });
    insertEmployee(state.db, { departmentId: created.data.id });
    await expect(archiveDepartmentAction({ id: created.data.id, archived: true })).resolves.toMatchObject({ ok: false, code: "DEPARTMENT_IN_USE" });
    state.user = employee;
    await expect(createDepartmentAction(dept("Sales"))).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("designation actions", () => {
  it("create, update and archive for org.manage holders only", async () => {
    const created = await createDesignationAction({ name: "Consultant", level: 2 });
    if (!created.ok) throw new Error(created.error);
    await expect(updateDesignationAction({ id: created.data.id, name: "Senior Consultant", level: 3 })).resolves.toMatchObject({ ok: true });
    await expect(archiveDesignationAction({ id: created.data.id, archived: true })).resolves.toMatchObject({ ok: true });
    expect(audits()).toEqual(["designation.create", "designation.update", "designation.archive"]);
    state.user = employee;
    await expect(createDesignationAction({ name: "Analyst", level: null })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("checklist template actions", () => {
  const template = {
    kind: "onboarding" as const, name: "Interns", isDefault: true,
    items: [{ label: "Assign a mentor", owner: "manager" as const }],
  };

  it("create, update and archive for employee.update holders only", async () => {
    const created = await createChecklistTemplateAction(template);
    if (!created.ok) throw new Error(created.error);
    await expect(updateChecklistTemplateAction({ ...template, name: "Summer interns", id: created.data.id })).resolves.toMatchObject({ ok: true });
    await expect(archiveChecklistTemplateAction({ id: created.data.id, archived: true })).resolves.toEqual({ ok: true, data: { archived: true } });
    expect(audits()).toEqual(["checklist_template.create", "checklist_template.update", "checklist_template.archive"]);
    state.user = employee;
    await expect(createChecklistTemplateAction(template)).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a template without items", async () => {
    await expect(createChecklistTemplateAction({ ...template, items: [] })).resolves.toMatchObject({
      ok: false, code: "VALIDATION", fieldErrors: { items: ["Add at least one item"] },
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/shell tests/unit/components/select-values.test.ts tests/integration/org-actions.test.ts`
Expected: FAIL. The nav test fails (no `Organization` group), and the select-values and action modules are missing.

- [ ] **Step 3: Update the navigation** — replace `src/components/shell/nav.ts`

```ts
import {
  BadgeCheck, Bell, Building, Building2, Contact, FileText, House, IdCard, Inbox, ListChecks, Network, ScrollText,
  ShieldCheck, Timer, Upload, UserRound, Users, type LucideIcon,
} from "lucide-react";
import { canAny, type Permission } from "@/lib/auth/permissions";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Visible when the user has any of these permissions; omit for everyone. */
  anyOf?: Permission[];
  /** Self-service pages: only for logins linked to an employee record. */
  requiresEmployee?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Later phases add groups (Team, Time, Leave, Payroll, Reports) and widen `anyOf` for Approvals. */
export const NAV: NavGroup[] = [
  {
    title: "Home",
    items: [
      { title: "Dashboard", href: "/", icon: House },
      { title: "Approvals", href: "/approvals", icon: Inbox, anyOf: ["employee.update"] },
      { title: "Notifications", href: "/notifications", icon: Bell },
    ],
  },
  {
    title: "My Space",
    items: [
      { title: "My profile", href: "/me/profile", icon: UserRound, requiresEmployee: true },
      { title: "My documents", href: "/me/documents", icon: FileText, requiresEmployee: true },
    ],
  },
  {
    title: "Organization",
    items: [
      { title: "Employees", href: "/org/employees", icon: Users, anyOf: ["employee.view"] },
      { title: "Directory", href: "/org/directory", icon: Contact, anyOf: ["directory.view"] },
      { title: "Org chart", href: "/org/chart", icon: Network, anyOf: ["directory.view"] },
      { title: "Departments", href: "/org/departments", icon: Building, anyOf: ["org.manage"] },
      { title: "Designations", href: "/org/designations", icon: BadgeCheck, anyOf: ["org.manage"] },
      { title: "Checklists", href: "/org/checklists", icon: ListChecks, anyOf: ["employee.update"] },
      { title: "Import", href: "/org/import", icon: Upload, anyOf: ["employee.import"] },
    ],
  },
  {
    title: "Settings",
    items: [
      { title: "Company", href: "/settings/company", icon: Building2, anyOf: ["settings.manage"] },
      { title: "Employee codes", href: "/settings/employee", icon: IdCard, anyOf: ["settings.manage"] },
      { title: "Users & roles", href: "/settings/users", icon: Users, anyOf: ["user.manage", "role.assign"] },
      { title: "Security", href: "/settings/security", icon: ShieldCheck, anyOf: ["settings.manage"] },
      { title: "Audit log", href: "/settings/audit", icon: ScrollText, anyOf: ["audit.view"] },
      { title: "Jobs", href: "/settings/jobs", icon: Timer, anyOf: ["job.run"] },
    ],
  },
];

export function visibleNav(permissions: readonly Permission[], opts: { hasEmployee?: boolean } = {}): NavGroup[] {
  const holder = { permissions };
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => (!item.anyOf || canAny(holder, item.anyOf)) && (!item.requiresEmployee || opts.hasEmployee === true),
    ),
  })).filter((group) => group.items.length > 0);
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
```

- [ ] **Step 4: Pass `hasEmployee` through the shell**

`src/components/shell/sidebar-nav.tsx`: change the signature and the `visibleNav` call:

```tsx
export function SidebarNav({
  permissions,
  hasEmployee,
  onNavigate,
}: {
  permissions: Permission[];
  hasEmployee: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups = visibleNav(permissions, { hasEmployee });
```

`src/components/shell/command-palette.tsx`: change the signature and the `visibleNav` call:

```tsx
export function CommandPalette({ permissions, hasEmployee }: { permissions: Permission[]; hasEmployee: boolean }) {
```

```tsx
            {visibleNav(permissions, { hasEmployee }).map((group) => (
```

`src/components/shell/app-shell.tsx`: add `hasEmployee` to the `user` prop type and pass it on:

```tsx
  user: { name: string; email: string; permissions: Permission[]; hasEmployee: boolean };
```

```tsx
        <SidebarNav permissions={user.permissions} hasEmployee={user.hasEmployee} />
```

```tsx
          <SidebarNav permissions={user.permissions} hasEmployee={user.hasEmployee} onNavigate={() => setMobileOpen(false)} />
```

```tsx
      <CommandPalette permissions={user.permissions} hasEmployee={user.hasEmployee} />
```

`src/app/(app)/layout.tsx`: pass `hasEmployee`:

```tsx
      user={{ name: user.name, email: user.email, permissions: user.permissions, hasEmployee: user.employeeId !== null }}
```

`src/app/(app)/page.tsx`: dashboard shortcuts honour it too:

```tsx
  const shortcuts = visibleNav(user.permissions, { hasEmployee: user.employeeId !== null })
    .flatMap((g) => g.items)
    .filter((i) => i.href !== "/");
```

- [ ] **Step 5: Create `src/components/forms/select-values.ts`**

```ts
/** `setValueAs` for selects/number inputs whose empty option means "none". */
export const idOrNull = (value: unknown): number | null =>
  value === "" || value === null || value === undefined ? null : Number(value);

/** `setValueAs` for enum selects whose empty option means "not set". */
export const textOrNull = (value: unknown) => (value === "" || value === undefined ? null : value);
```

- [ ] **Step 6: Departments** — `src/app/(app)/org/departments/actions.ts`

```ts
"use server";

import { z } from "zod";
import { departmentSchema } from "@/lib/validation/org";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { createDepartment, setDepartmentArchived, updateDepartment } from "@/server/modules/org/service";

const PATHS = ["/org/departments"];

export const createDepartmentAction = defineAction({
  name: "departments.create",
  schema: departmentSchema,
  permission: "org.manage",
  handler: ({ tx, audit }, input) => {
    const row = createDepartment(tx, input);
    audit({ action: "department.create", entityType: "department", entityId: row.id, summary: `Created department ${row.name}` });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateDepartmentAction = defineAction({
  name: "departments.update",
  schema: departmentSchema.extend({ id: z.number().int().positive() }),
  permission: "org.manage",
  handler: ({ tx, audit }, { id, ...input }) => {
    const { before, after } = updateDepartment(tx, id, input);
    audit({
      action: "department.update", entityType: "department", entityId: id,
      summary: `Updated department ${after.name}`, diff: diffObjects(before, after),
    });
    return { id };
  },
  revalidate: PATHS,
});

export const archiveDepartmentAction = defineAction({
  name: "departments.archive",
  schema: z.object({ id: z.number().int().positive(), archived: z.boolean() }),
  permission: "org.manage",
  handler: ({ tx, audit }, { id, archived }) => {
    const row = setDepartmentArchived(tx, id, archived);
    audit({
      action: archived ? "department.archive" : "department.restore", entityType: "department", entityId: id,
      summary: `${archived ? "Archived" : "Restored"} department ${row.name}`,
    });
    return { archived: row.archived };
  },
  revalidate: PATHS,
});
```

`src/app/(app)/org/departments/departments-client.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Ellipsis, Pencil, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { idOrNull } from "@/components/forms/select-values";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import type { SelectOption } from "@/lib/hr";
import { departmentSchema } from "@/lib/validation/org";
import type { DepartmentListItem } from "@/server/modules/org/queries";
import { archiveDepartmentAction, createDepartmentAction, updateDepartmentAction } from "./actions";

type FormInput = z.input<typeof departmentSchema>;
type FormOutput = z.output<typeof departmentSchema>;

function DepartmentSheet({
  open,
  onOpenChange,
  editing,
  parentOptions,
  headOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: DepartmentListItem | null;
  parentOptions: SelectOption[];
  headOptions: SelectOption[];
}) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(departmentSchema),
    values: {
      name: editing?.name ?? "",
      code: editing?.code ?? "",
      parentId: editing?.parentId ?? null,
      headEmployeeId: editing?.headEmployeeId ?? null,
    },
  });
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createDepartmentAction, { successMessage: "Department created", onSuccess: done, onError });
  const update = useServerAction(updateDepartmentAction, { successMessage: "Department updated", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  const errors = form.formState.errors;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? "Edit department" : "New department"}</SheetTitle>
          <SheetDescription>Departments can sit under a parent department.</SheetDescription>
        </SheetHeader>
        <form
          onSubmit={form.handleSubmit((values) => (editing ? update.run({ ...values, id: editing.id }) : create.run(values)))}
          className="flex flex-1 flex-col gap-4"
        >
          <Field label="Name" htmlFor="dept-name" error={errors.name?.message} required>
            <Input id="dept-name" {...form.register("name")} />
          </Field>
          <Field label="Code" htmlFor="dept-code" error={errors.code?.message} hint="Optional short code, e.g. ENG">
            <Input id="dept-code" {...form.register("code")} />
          </Field>
          <Field label="Parent department" htmlFor="dept-parent" error={errors.parentId?.message}>
            <NativeSelect id="dept-parent" {...form.register("parentId", { setValueAs: idOrNull })}>
              <option value="">None</option>
              {parentOptions
                .filter((o) => o.id !== editing?.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Head" htmlFor="dept-head" error={errors.headEmployeeId?.message}>
            <NativeSelect id="dept-head" {...form.register("headEmployeeId", { setValueAs: idOrNull })}>
              <option value="">None</option>
              {headOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save department" : "Create department"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function DepartmentsClient({
  departments,
  parentOptions,
  headOptions,
}: {
  departments: DepartmentListItem[];
  parentOptions: SelectOption[];
  headOptions: SelectOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentListItem | null>(null);
  const archive = useServerAction(archiveDepartmentAction, {
    successMessage: (d) => (d.archived ? "Department archived" : "Department restored"),
    onSuccess: () => router.refresh(),
  });
  const openSheet = (department: DepartmentListItem | null) => {
    setEditing(department);
    setOpen(true);
  };

  const columns: ColumnDef<DepartmentListItem>[] = [
    {
      id: "name",
      header: "Department",
      accessorFn: (d) => `${d.name} ${d.code ?? ""}`,
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          {row.original.code && <p className="text-xs text-muted-foreground">{row.original.code}</p>}
        </div>
      ),
    },
    { id: "parent", header: "Parent", accessorFn: (d) => d.parentName ?? "—" },
    { id: "head", header: "Head", accessorFn: (d) => d.headName ?? "—" },
    { accessorKey: "employeeCount", header: "Employees" },
    {
      id: "status",
      header: "Status",
      accessorFn: (d) => (d.archived ? "Archived" : "Active"),
      cell: ({ row }) =>
        row.original.archived ? <Badge variant="secondary">Archived</Badge> : <Badge variant="success">Active</Badge>,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${row.original.name}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => openSheet(row.original)}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => archive.run({ id: row.original.id, archived: !row.original.archived })}>
              {row.original.archived ? <ArchiveRestore /> : <Archive />}
              {row.original.archived ? "Restore" : "Archive"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={departments}
        searchPlaceholder="Search departments…"
        toolbar={
          <Button onClick={() => openSheet(null)}>
            <Plus /> New department
          </Button>
        }
      />
      <DepartmentSheet open={open} onOpenChange={setOpen} editing={editing} parentOptions={parentOptions} headOptions={headOptions} />
    </>
  );
}
```

`src/app/(app)/org/departments/page.tsx`:

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { employeeOptions } from "@/server/modules/employees/queries";
import { departmentOptions, listDepartments } from "@/server/modules/org/queries";
import { DepartmentsClient } from "./departments-client";

export const metadata: Metadata = { title: "Departments" };

export default async function DepartmentsPage() {
  await requirePermission("org.manage");
  return (
    <>
      <PageHeader title="Departments" description="Teams employees belong to. Archive a department once nobody is left in it." />
      <DepartmentsClient departments={listDepartments(db)} parentOptions={departmentOptions(db)} headOptions={employeeOptions(db)} />
    </>
  );
}
```

- [ ] **Step 7: Designations** — `src/app/(app)/org/designations/actions.ts`

```ts
"use server";

import { z } from "zod";
import { designationSchema } from "@/lib/validation/org";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { createDesignation, setDesignationArchived, updateDesignation } from "@/server/modules/org/service";

const PATHS = ["/org/designations"];

export const createDesignationAction = defineAction({
  name: "designations.create",
  schema: designationSchema,
  permission: "org.manage",
  handler: ({ tx, audit }, input) => {
    const row = createDesignation(tx, input);
    audit({ action: "designation.create", entityType: "designation", entityId: row.id, summary: `Created designation ${row.name}` });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateDesignationAction = defineAction({
  name: "designations.update",
  schema: designationSchema.extend({ id: z.number().int().positive() }),
  permission: "org.manage",
  handler: ({ tx, audit }, { id, ...input }) => {
    const { before, after } = updateDesignation(tx, id, input);
    audit({
      action: "designation.update", entityType: "designation", entityId: id,
      summary: `Updated designation ${after.name}`, diff: diffObjects(before, after),
    });
    return { id };
  },
  revalidate: PATHS,
});

export const archiveDesignationAction = defineAction({
  name: "designations.archive",
  schema: z.object({ id: z.number().int().positive(), archived: z.boolean() }),
  permission: "org.manage",
  handler: ({ tx, audit }, { id, archived }) => {
    const row = setDesignationArchived(tx, id, archived);
    audit({
      action: archived ? "designation.archive" : "designation.restore", entityType: "designation", entityId: id,
      summary: `${archived ? "Archived" : "Restored"} designation ${row.name}`,
    });
    return { archived: row.archived };
  },
  revalidate: PATHS,
});
```

`src/app/(app)/org/designations/designations-client.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Ellipsis, Pencil, Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { idOrNull } from "@/components/forms/select-values";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { designationSchema } from "@/lib/validation/org";
import type { DesignationListItem } from "@/server/modules/org/queries";
import { archiveDesignationAction, createDesignationAction, updateDesignationAction } from "./actions";

type FormInput = z.input<typeof designationSchema>;
type FormOutput = z.output<typeof designationSchema>;

function DesignationSheet({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: DesignationListItem | null;
}) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(designationSchema),
    values: { name: editing?.name ?? "", level: editing?.level ?? null },
  });
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createDesignationAction, { successMessage: "Designation created", onSuccess: done, onError });
  const update = useServerAction(updateDesignationAction, { successMessage: "Designation updated", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  const errors = form.formState.errors;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? "Edit designation" : "New designation"}</SheetTitle>
          <SheetDescription>Job titles. The optional level orders them from junior to senior.</SheetDescription>
        </SheetHeader>
        <form
          onSubmit={form.handleSubmit((values) => (editing ? update.run({ ...values, id: editing.id }) : create.run(values)))}
          className="flex flex-1 flex-col gap-4"
        >
          <Field label="Name" htmlFor="desig-name" error={errors.name?.message} required>
            <Input id="desig-name" {...form.register("name")} />
          </Field>
          <Field label="Level" htmlFor="desig-level" error={errors.level?.message} hint="0–99, optional">
            <Input id="desig-level" type="number" min={0} max={99} {...form.register("level", { setValueAs: idOrNull })} />
          </Field>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save designation" : "Create designation"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function DesignationsClient({ designations }: { designations: DesignationListItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DesignationListItem | null>(null);
  const archive = useServerAction(archiveDesignationAction, {
    successMessage: (d) => (d.archived ? "Designation archived" : "Designation restored"),
    onSuccess: () => router.refresh(),
  });
  const openSheet = (designation: DesignationListItem | null) => {
    setEditing(designation);
    setOpen(true);
  };

  const columns: ColumnDef<DesignationListItem>[] = [
    { accessorKey: "name", header: "Designation", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { id: "level", header: "Level", accessorFn: (d) => d.level ?? "—" },
    { accessorKey: "employeeCount", header: "Employees" },
    {
      id: "status",
      header: "Status",
      accessorFn: (d) => (d.archived ? "Archived" : "Active"),
      cell: ({ row }) =>
        row.original.archived ? <Badge variant="secondary">Archived</Badge> : <Badge variant="success">Active</Badge>,
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${row.original.name}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => openSheet(row.original)}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => archive.run({ id: row.original.id, archived: !row.original.archived })}>
              {row.original.archived ? <ArchiveRestore /> : <Archive />}
              {row.original.archived ? "Restore" : "Archive"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={designations}
        searchPlaceholder="Search designations…"
        toolbar={
          <Button onClick={() => openSheet(null)}>
            <Plus /> New designation
          </Button>
        }
      />
      <DesignationSheet open={open} onOpenChange={setOpen} editing={editing} />
    </>
  );
}
```

`src/app/(app)/org/designations/page.tsx`:

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listDesignations } from "@/server/modules/org/queries";
import { DesignationsClient } from "./designations-client";

export const metadata: Metadata = { title: "Designations" };

export default async function DesignationsPage() {
  await requirePermission("org.manage");
  return (
    <>
      <PageHeader title="Designations" description="Job titles used on profiles, payslips and letters." />
      <DesignationsClient designations={listDesignations(db)} />
    </>
  );
}
```

- [ ] **Step 8: Checklist templates** — `src/app/(app)/org/checklists/actions.ts`

```ts
"use server";

import { z } from "zod";
import { CHECKLIST_KIND_LABELS } from "@/lib/hr";
import { checklistTemplateSchema } from "@/lib/validation/org";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import {
  createChecklistTemplate, setChecklistTemplateArchived, updateChecklistTemplate,
} from "@/server/modules/employees/checklists";

const PATHS = ["/org/checklists"];

export const createChecklistTemplateAction = defineAction({
  name: "checklists.create",
  schema: checklistTemplateSchema,
  permission: "employee.update",
  handler: ({ tx, audit }, input) => {
    const row = createChecklistTemplate(tx, input);
    audit({
      action: "checklist_template.create", entityType: "checklist_template", entityId: row.id,
      summary: `Created ${CHECKLIST_KIND_LABELS[row.kind].toLowerCase()} checklist "${row.name}"`,
    });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateChecklistTemplateAction = defineAction({
  name: "checklists.update",
  schema: checklistTemplateSchema.extend({ id: z.number().int().positive() }),
  permission: "employee.update",
  handler: ({ tx, audit }, { id, ...input }) => {
    const { before, after } = updateChecklistTemplate(tx, id, input);
    audit({
      action: "checklist_template.update", entityType: "checklist_template", entityId: id,
      summary: `Updated checklist "${after.name}"`, diff: diffObjects(before, after),
    });
    return { id };
  },
  revalidate: PATHS,
});

export const archiveChecklistTemplateAction = defineAction({
  name: "checklists.archive",
  schema: z.object({ id: z.number().int().positive(), archived: z.boolean() }),
  permission: "employee.update",
  handler: ({ tx, audit }, { id, archived }) => {
    const row = setChecklistTemplateArchived(tx, id, archived);
    audit({
      action: archived ? "checklist_template.archive" : "checklist_template.restore", entityType: "checklist_template",
      entityId: id, summary: `${archived ? "Archived" : "Restored"} checklist "${row.name}"`,
    });
    return { archived: row.archived };
  },
  revalidate: PATHS,
});
```

`src/app/(app)/org/checklists/templates-client.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, ArchiveRestore, Pencil, Plus, Trash2 } from "lucide-react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { CHECKLIST_KIND_LABELS, CHECKLIST_KINDS, CHECKLIST_OWNER_LABELS, CHECKLIST_OWNERS } from "@/lib/hr";
import { checklistTemplateSchema } from "@/lib/validation/org";
import type { ChecklistTemplateRow } from "@/server/db/schema";
import { archiveChecklistTemplateAction, createChecklistTemplateAction, updateChecklistTemplateAction } from "./actions";

type FormInput = z.input<typeof checklistTemplateSchema>;
type FormOutput = z.output<typeof checklistTemplateSchema>;
const BLANK: FormInput = { kind: "onboarding", name: "", items: [{ label: "", owner: "hr" }], isDefault: false };

function TemplateSheet({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: ChecklistTemplateRow | null;
}) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(checklistTemplateSchema),
    values: editing ? { kind: editing.kind, name: editing.name, items: editing.items, isDefault: editing.isDefault } : BLANK,
  });
  const items = useFieldArray({ control: form.control, name: "items" });
  const done = () => {
    onOpenChange(false);
    router.refresh();
  };
  const onError = (r: { fieldErrors?: Record<string, string[]> }) => applyFieldErrors(form.setError, r.fieldErrors);
  const create = useServerAction(createChecklistTemplateAction, { successMessage: "Template created", onSuccess: done, onError });
  const update = useServerAction(updateChecklistTemplateAction, { successMessage: "Template updated", onSuccess: done, onError });
  const pending = create.pending || update.pending;
  const errors = form.formState.errors;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{editing ? "Edit checklist template" : "New checklist template"}</SheetTitle>
          <SheetDescription>
            New joiners get the default onboarding template; resignations get the default offboarding one.
          </SheetDescription>
        </SheetHeader>
        <form
          onSubmit={form.handleSubmit((values) => (editing ? update.run({ ...values, id: editing.id }) : create.run(values)))}
          className="flex flex-1 flex-col gap-4"
        >
          <Field label="Name" htmlFor="tpl-name" error={errors.name?.message} required>
            <Input id="tpl-name" {...form.register("name")} />
          </Field>
          <Field label="Kind" htmlFor="tpl-kind">
            <NativeSelect id="tpl-kind" {...form.register("kind")}>
              {CHECKLIST_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {CHECKLIST_KIND_LABELS[kind]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div className="flex items-center gap-2">
            <Controller
              control={form.control}
              name="isDefault"
              render={({ field }) => <Switch id="tpl-default" checked={field.value} onCheckedChange={field.onChange} />}
            />
            <Label htmlFor="tpl-default">Default for this kind</Label>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Items</legend>
            {items.fields.map((item, index) => (
              <div key={item.id} className="flex items-start gap-2">
                <div className="flex-1 space-y-1">
                  <Input aria-label={`Item ${index + 1}`} placeholder="What needs doing" {...form.register(`items.${index}.label`)} />
                  {errors.items?.[index]?.label?.message && (
                    <p className="text-xs text-destructive">{errors.items[index]?.label?.message}</p>
                  )}
                </div>
                <div className="w-32 shrink-0">
                  <NativeSelect aria-label={`Owner of item ${index + 1}`} {...form.register(`items.${index}.owner`)}>
                    {CHECKLIST_OWNERS.map((owner) => (
                      <option key={owner} value={owner}>
                        {CHECKLIST_OWNER_LABELS[owner]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove item ${index + 1}`}
                  disabled={items.fields.length === 1}
                  onClick={() => items.remove(index)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            {errors.items?.message && <p className="text-xs text-destructive">{errors.items.message}</p>}
            <Button type="button" variant="outline" size="sm" onClick={() => items.append({ label: "", owner: "hr" })}>
              <Plus /> Add item
            </Button>
          </fieldset>
          <SheetFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              {editing ? "Save template" : "Create template"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function TemplatesClient({ templates }: { templates: ChecklistTemplateRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ChecklistTemplateRow | null>(null);
  const archive = useServerAction(archiveChecklistTemplateAction, {
    successMessage: (d) => (d.archived ? "Template archived" : "Template restored"),
    onSuccess: () => router.refresh(),
  });
  const openSheet = (template: ChecklistTemplateRow | null) => {
    setEditing(template);
    setOpen(true);
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => openSheet(null)}>
          <Plus /> New template
        </Button>
      </div>
      {templates.length === 0 ? (
        <EmptyState title="No checklist templates" description="Create an onboarding template so every new joiner starts from the same list." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template) => (
            <Card key={template.id} className={template.archived ? "opacity-70" : undefined}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">{template.name}</CardTitle>
                  <Badge variant="secondary">{CHECKLIST_KIND_LABELS[template.kind]}</Badge>
                  {template.isDefault && <Badge variant="success">Default</Badge>}
                  {template.archived && <Badge variant="outline">Archived</Badge>}
                </div>
                <CardDescription>{template.items.length} item(s)</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {template.items.map((item, i) => (
                    <li key={i}>
                      {item.label} <span className="text-muted-foreground">· {CHECKLIST_OWNER_LABELS[item.owner]}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
              <CardFooter className="justify-end">
                <Button variant="ghost" size="sm" onClick={() => openSheet(template)}>
                  <Pencil /> Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={archive.pending}
                  onClick={() => archive.run({ id: template.id, archived: !template.archived })}
                >
                  {template.archived ? <ArchiveRestore /> : <Archive />}
                  {template.archived ? "Restore" : "Archive"}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      <TemplateSheet open={open} onOpenChange={setOpen} editing={editing} />
    </>
  );
}
```

`src/app/(app)/org/checklists/page.tsx`:

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listChecklistTemplates } from "@/server/modules/employees/checklists";
import { TemplatesClient } from "./templates-client";

export const metadata: Metadata = { title: "Checklists" };

export default async function ChecklistsPage() {
  await requirePermission("employee.update");
  return (
    <>
      <PageHeader title="Checklists" description="Onboarding and offboarding templates. Each employee gets a copy they can tick off." />
      <TemplatesClient templates={listChecklistTemplates(db)} />
    </>
  );
}
```

- [ ] **Step 9: Run to verify pass**

Run: `npx vitest run tests/unit/shell tests/unit/components tests/integration/org-actions.test.ts && npm run typecheck && npm run lint`
Expected: PASS. Typecheck is clean; lint has 0 errors (the `useReactTable` warning from Phase 0 remains).

- [ ] **Step 10: Manual check**

Start a dev server on a throwaway DB, e.g. `DB_FILE=./data/smoke.db npm run db:migrate && DB_FILE=./data/smoke.db npm run db:seed && DB_FILE=./data/smoke.db npx next dev -p 3200`. Sign in as the seeded admin and:
- see the Home, My Space (hidden: the seeded admin has no employee record), Organization and Settings groups;
- create, edit, archive and restore a department and a designation;
- edit the seeded "Standard onboarding" template and add an item.

Stop the server (find the listener with `ss -ltnp | grep :3200`, kill it by PID) and delete `data/smoke.db*`.

- [ ] **Step 11: Commit**

```bash
git add src/components/shell src/components/forms/select-values.ts "src/app/(app)/layout.tsx" "src/app/(app)/page.tsx" "src/app/(app)/org" tests/unit tests/integration/org-actions.test.ts
git commit -m "feat(org): add navigation groups and department, designation and checklist pages"
```

---
### Task 14: Employee list and the create wizard

**Files:**
- Move: `src/app/(app)/settings/users/role-picker.tsx` → `src/components/users/role-picker.tsx`, `src/app/(app)/settings/users/temp-password-dialog.tsx` → `src/components/users/temp-password-dialog.tsx`
- Modify: `src/app/(app)/settings/users/users-table.tsx`, `src/app/(app)/settings/users/add-user-sheet.tsx` (imports)
- Create: `src/components/employees/{status-badge,personal-fields,job-fields,bank-fields}.tsx`, `src/components/employees/form-defaults.ts`, `src/components/employees/filters.ts`
- Create: `src/app/(app)/org/employees/{page,employees-table}.tsx`, `src/app/(app)/org/employees/actions.ts`, `src/app/(app)/org/employees/new/{page,employee-wizard}.tsx`
- Test: `tests/unit/components/employee-filters.test.ts`, `tests/integration/employee-create-action.test.ts`

**Interfaces:**
- Consumes:
  - `createEmployee`, `LoginPlan` (Task 7); `listEmployees`, `employeeOptions`, `unlinkedUserOptions`, `EmployeeDetail` (Task 8); `nextEmployeeCode` (Task 4).
  - `departmentOptions`, `designationOptions` (Task 3); `createEmployeeSchema` (Task 1); `idOrNull`, `textOrNull` (Task 13).
- Produces:
  - Components `EmployeeStatusBadge`; `PersonalFields({ part: "basic" | "details" | "contact" | "all" })` with `PersonalFormShape`; `JobFields({ departments, designations, managers, codeHint?, showConfirmation? })` with `JobFormShape`; `BankFields({ keepHint? })` with `BankFormShape`.
  - `form-defaults.ts`: `EMPTY_ADDRESS`, `EMPTY_EMERGENCY_CONTACT`, `personalDefaults(detail)`, `jobDefaults(detail)`, `bankDefaults(bank)`.
  - `filters.ts`: `StatusFilter`, `filterEmployees(rows, { status, departmentId })`.
  - `createEmployeeAction` (returns `{ id, employeeCode, tempPassword, loginEmail }`).
  - Pages `/org/employees` (`employee.view`) and `/org/employees/new` (`employee.create`).
  - `RolePicker` and `TempPasswordDialog` now live in `src/components/users/`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/components/employee-filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterEmployees } from "@/components/employees/filters";

const rows = [
  { id: 1, status: "active" as const, departmentId: 1 },
  { id: 2, status: "on_notice" as const, departmentId: 2 },
  { id: 3, status: "exited" as const, departmentId: 1 },
];
const ids = (list: { id: number }[]) => list.map((r) => r.id);

describe("filterEmployees", () => {
  it("shows current employees by default and filters by status and department", () => {
    expect(ids(filterEmployees(rows, { status: "current", departmentId: null }))).toEqual([1, 2]);
    expect(ids(filterEmployees(rows, { status: "exited", departmentId: null }))).toEqual([3]);
    expect(ids(filterEmployees(rows, { status: "all", departmentId: 1 }))).toEqual([1, 3]);
  });
});
```

`tests/integration/employee-create-action.test.ts`:

```ts
import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { CreateEmployeeFormValues } from "@/lib/validation/employees";
import type { DB } from "@/server/db/client";
import { auditLogs, employees } from "@/server/db/schema";
import { listEmployeeChecklists, seedDefaultChecklistTemplates } from "@/server/modules/employees/checklists";
import { findUserByEmail } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { createEmployeeAction } from "@/app/(app)/org/employees/actions";

const input = (patch: Partial<CreateEmployeeFormValues> = {}): CreateEmployeeFormValues => ({
  firstName: "Asha", lastName: "Rao", displayName: "", workEmail: "asha@pvcon.in", personalEmail: "", phone: "",
  dateOfBirth: "", gender: null, maritalStatus: null, address: null, emergencyContact: null,
  departmentId: null, designationId: null, reportingManagerId: null, employmentType: "full_time", workLocation: "",
  dateOfJoining: "2026-10-01", probationEndDate: "", confirmationDate: "", noticePeriodDays: 30,
  bankName: "", bankAccount: "", bankIfsc: "", pan: "", aadhaar: "", passport: "",
  employeeCode: "", loginMode: "none", loginRoles: ["employee"], linkUserId: null,
  ...patch,
});

let hr: SessionUser;
beforeEach(() => {
  state.db = createTestDb();
  seedDefaultChecklistTemplates(state.db);
  hr = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
  state.user = hr;
});

describe("createEmployeeAction", () => {
  it("creates the employee with an onboarding checklist and a login whose temporary password is shown once", async () => {
    const result = await createEmployeeAction(input({ loginMode: "create" }));
    if (!result.ok) throw new Error(result.error);
    expect(result.data).toMatchObject({ employeeCode: "PV0001", loginEmail: "asha@pvcon.in" });
    const user = findUserByEmail(state.db, "asha@pvcon.in")!;
    expect(bcrypt.compareSync(result.data.tempPassword!, user.passwordHash)).toBe(true);
    expect(listEmployeeChecklists(state.db, result.data.id).map((c) => c.kind)).toEqual(["onboarding"]);
    expect(state.db.select().from(auditLogs).all().map((a) => a.action)).toEqual(["employee.create"]);
  });

  it("returns no password when no login is created", async () => {
    await expect(createEmployeeAction(input())).resolves.toMatchObject({ ok: true, data: { tempPassword: null, loginEmail: null } });
  });

  it("refuses logins outside the company domain and missing work emails, as field errors", async () => {
    await expect(createEmployeeAction(input({ loginMode: "create", workEmail: "asha@gmail.com" }))).resolves.toMatchObject({
      ok: false, code: "EMAIL_DOMAIN", fieldErrors: { workEmail: ["Must be an @pvcon.in address"] },
    });
    await expect(createEmployeeAction(input({ loginMode: "create", workEmail: "" }))).resolves.toMatchObject({
      ok: false, code: "VALIDATION", fieldErrors: { workEmail: ["Required to create a login"] },
    });
    expect(state.db.select().from(employees).all()).toEqual([]);
  });

  it("needs employee.create, and user management rights to create or link a login", async () => {
    state.user = { ...hr, permissions: hr.permissions.filter((p) => p !== "user.manage") };
    await expect(createEmployeeAction(input({ loginMode: "create" }))).resolves.toMatchObject({ code: "FORBIDDEN" });
    await expect(createEmployeeAction(input())).resolves.toMatchObject({ ok: true });
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["payroll_admin"] }));
    await expect(createEmployeeAction(input({ workEmail: "ravi@pvcon.in" }))).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/components/employee-filters.test.ts tests/integration/employee-create-action.test.ts`
Expected: FAIL — `@/components/employees/filters` and `@/app/(app)/org/employees/actions` are missing.

- [ ] **Step 3: Move the user components**

```bash
mkdir -p src/components/users
git mv "src/app/(app)/settings/users/role-picker.tsx" src/components/users/role-picker.tsx
git mv "src/app/(app)/settings/users/temp-password-dialog.tsx" src/components/users/temp-password-dialog.tsx
```

In `src/app/(app)/settings/users/users-table.tsx`, replace the two relative imports:

```tsx
import { RolePicker } from "@/components/users/role-picker";
import { TempPasswordDialog } from "@/components/users/temp-password-dialog";
```

In `src/app/(app)/settings/users/add-user-sheet.tsx`, replace `import { RolePicker } from "./role-picker";` with:

```tsx
import { RolePicker } from "@/components/users/role-picker";
```

- [ ] **Step 4: Create the shared employee components**

`src/components/employees/filters.ts`:

```ts
import type { EmployeeStatus } from "@/lib/hr";

/** "current" = active or on notice. */
export type StatusFilter = "current" | "all" | EmployeeStatus;

export function filterEmployees<T extends { status: EmployeeStatus; departmentId: number | null }>(
  rows: T[],
  filter: { status: StatusFilter; departmentId: number | null },
): T[] {
  return rows.filter((row) => {
    const statusOk =
      filter.status === "all" || (filter.status === "current" ? row.status !== "exited" : row.status === filter.status);
    return statusOk && (filter.departmentId === null || row.departmentId === filter.departmentId);
  });
}
```

`src/components/employees/status-badge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { EMPLOYEE_STATUS_LABELS, type EmployeeStatus } from "@/lib/hr";

const VARIANT = { active: "success", on_notice: "warning", exited: "secondary" } as const;

export function EmployeeStatusBadge({ status }: { status: EmployeeStatus }) {
  return <Badge variant={VARIANT[status]}>{EMPLOYEE_STATUS_LABELS[status]}</Badge>;
}
```

`src/components/employees/form-defaults.ts`:

```ts
import type { EmployeeDetail } from "@/server/modules/employees/queries";
import type { BankView } from "@/server/modules/employees/sensitive";

export const EMPTY_ADDRESS = { line1: "", line2: "", city: "", state: "", postalCode: "", country: "" };
export const EMPTY_EMERGENCY_CONTACT = { name: "", relation: "", phone: "" };

export function personalDefaults(e: EmployeeDetail) {
  return {
    firstName: e.firstName,
    lastName: e.lastName,
    displayName: e.displayName,
    workEmail: e.workEmail ?? "",
    personalEmail: e.personalEmail ?? "",
    phone: e.phone ?? "",
    dateOfBirth: e.dateOfBirth ?? "",
    gender: e.gender,
    maritalStatus: e.maritalStatus,
    address: e.address ?? EMPTY_ADDRESS,
    emergencyContact: e.emergencyContact ?? EMPTY_EMERGENCY_CONTACT,
  };
}

export function jobDefaults(e: EmployeeDetail) {
  return {
    departmentId: e.departmentId,
    designationId: e.designationId,
    reportingManagerId: e.reportingManagerId,
    employmentType: e.employmentType,
    workLocation: e.workLocation ?? "",
    dateOfJoining: e.dateOfJoining,
    probationEndDate: e.probationEndDate ?? "",
    confirmationDate: e.confirmationDate ?? "",
    noticePeriodDays: e.noticePeriodDays,
  };
}

export function bankDefaults(bank: BankView) {
  return {
    bankName: bank.bankName ?? "",
    bankAccount: bank.bankAccount ?? "",
    bankIfsc: bank.bankIfsc ?? "",
    pan: bank.pan ?? "",
    aadhaar: bank.aadhaar ?? "",
    passport: bank.passport ?? "",
  };
}
```

`src/components/employees/personal-fields.tsx`:

```tsx
"use client";

import { useFormContext } from "react-hook-form";
import { textOrNull } from "@/components/forms/select-values";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { GENDER_LABELS, GENDERS, MARITAL_STATUS_LABELS, MARITAL_STATUSES } from "@/lib/hr";

/** Form shape shared by the wizard, the HR Personal tab and self-service contact edits. */
export interface PersonalFormShape {
  firstName: string;
  lastName: string;
  displayName: string | null;
  workEmail: string | null;
  personalEmail: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  address: { line1: string; line2: string; city: string; state: string; postalCode: string; country: string };
  emergencyContact: { name: string; relation: string; phone: string };
}

/**
 * `basic`: names, work email, phone (wizard step 1). `details`: DOB, gender, marital status, personal email, address,
 * emergency contact (wizard step 3). `contact`: what employees may change themselves. `all`: everything (HR).
 */
export type PersonalPart = "basic" | "details" | "contact" | "all";

export function PersonalFields({ part }: { part: PersonalPart }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<PersonalFormShape>();
  const basic = part === "basic" || part === "all";
  const identity = part === "details" || part === "all";
  const contact = part !== "basic";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {basic && (
        <>
          <Field label="First name" htmlFor="firstName" error={errors.firstName?.message} required>
            <Input id="firstName" autoComplete="off" {...register("firstName")} />
          </Field>
          <Field label="Last name" htmlFor="lastName" error={errors.lastName?.message}>
            <Input id="lastName" autoComplete="off" {...register("lastName")} />
          </Field>
          <Field label="Display name" htmlFor="displayName" error={errors.displayName?.message} hint="Defaults to first and last name">
            <Input id="displayName" {...register("displayName")} />
          </Field>
          <Field label="Work email" htmlFor="workEmail" error={errors.workEmail?.message}>
            <Input id="workEmail" type="email" autoComplete="off" {...register("workEmail")} />
          </Field>
        </>
      )}
      {(basic || part === "contact") && (
        <Field label="Phone" htmlFor="phone" error={errors.phone?.message}>
          <Input id="phone" type="tel" {...register("phone")} />
        </Field>
      )}
      {identity && (
        <>
          <Field label="Date of birth" htmlFor="dateOfBirth" error={errors.dateOfBirth?.message}>
            <Input id="dateOfBirth" type="date" {...register("dateOfBirth")} />
          </Field>
          <Field label="Gender" htmlFor="gender">
            <NativeSelect id="gender" {...register("gender", { setValueAs: textOrNull })}>
              <option value="">Not set</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {GENDER_LABELS[g]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Marital status" htmlFor="maritalStatus">
            <NativeSelect id="maritalStatus" {...register("maritalStatus", { setValueAs: textOrNull })}>
              <option value="">Not set</option>
              {MARITAL_STATUSES.map((m) => (
                <option key={m} value={m}>
                  {MARITAL_STATUS_LABELS[m]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </>
      )}
      {contact && (
        <>
          <Field label="Personal email" htmlFor="personalEmail" error={errors.personalEmail?.message}>
            <Input id="personalEmail" type="email" {...register("personalEmail")} />
          </Field>
          <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Address</legend>
            <Field label="Address line 1" htmlFor="address.line1" className="sm:col-span-2">
              <Input id="address.line1" {...register("address.line1")} />
            </Field>
            <Field label="Address line 2" htmlFor="address.line2" className="sm:col-span-2">
              <Input id="address.line2" {...register("address.line2")} />
            </Field>
            <Field label="City" htmlFor="address.city">
              <Input id="address.city" {...register("address.city")} />
            </Field>
            <Field label="State" htmlFor="address.state">
              <Input id="address.state" {...register("address.state")} />
            </Field>
            <Field label="Postal code" htmlFor="address.postalCode">
              <Input id="address.postalCode" {...register("address.postalCode")} />
            </Field>
            <Field label="Country" htmlFor="address.country">
              <Input id="address.country" {...register("address.country")} />
            </Field>
          </fieldset>
          <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-medium">Emergency contact</legend>
            <Field label="Contact name" htmlFor="emergencyContact.name">
              <Input id="emergencyContact.name" {...register("emergencyContact.name")} />
            </Field>
            <Field label="Relation" htmlFor="emergencyContact.relation">
              <Input id="emergencyContact.relation" {...register("emergencyContact.relation")} />
            </Field>
            <Field label="Contact phone" htmlFor="emergencyContact.phone" error={errors.emergencyContact?.phone?.message}>
              <Input id="emergencyContact.phone" type="tel" {...register("emergencyContact.phone")} />
            </Field>
          </fieldset>
        </>
      )}
    </div>
  );
}
```

`src/components/employees/job-fields.tsx`:

```tsx
"use client";

import { useFormContext } from "react-hook-form";
import { idOrNull } from "@/components/forms/select-values";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_TYPES, type SelectOption } from "@/lib/hr";

export interface JobFormShape {
  employeeCode?: string | null;
  departmentId: number | null;
  designationId: number | null;
  reportingManagerId: number | null;
  employmentType: string;
  workLocation: string | null;
  dateOfJoining: string;
  probationEndDate: string | null;
  confirmationDate: string | null;
  noticePeriodDays: number;
}

const options = (items: SelectOption[]) =>
  items.map((o) => (
    <option key={o.id} value={o.id}>
      {o.label}
    </option>
  ));

export function JobFields({
  departments,
  designations,
  managers,
  codeHint,
  showConfirmation = false,
}: {
  departments: SelectOption[];
  designations: SelectOption[];
  managers: SelectOption[];
  /** Shows the optional employee code field with this hint (wizard only). */
  codeHint?: string;
  showConfirmation?: boolean;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<JobFormShape>();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {codeHint !== undefined && (
        <Field label="Employee code" htmlFor="employeeCode" error={errors.employeeCode?.message} hint={codeHint}>
          <Input id="employeeCode" {...register("employeeCode")} />
        </Field>
      )}
      <Field label="Date of joining" htmlFor="dateOfJoining" error={errors.dateOfJoining?.message} required>
        <Input id="dateOfJoining" type="date" {...register("dateOfJoining")} />
      </Field>
      <Field label="Department" htmlFor="departmentId" error={errors.departmentId?.message}>
        <NativeSelect id="departmentId" {...register("departmentId", { setValueAs: idOrNull })}>
          <option value="">None</option>
          {options(departments)}
        </NativeSelect>
      </Field>
      <Field label="Designation" htmlFor="designationId" error={errors.designationId?.message}>
        <NativeSelect id="designationId" {...register("designationId", { setValueAs: idOrNull })}>
          <option value="">None</option>
          {options(designations)}
        </NativeSelect>
      </Field>
      <Field label="Reporting manager" htmlFor="reportingManagerId" error={errors.reportingManagerId?.message}>
        <NativeSelect id="reportingManagerId" {...register("reportingManagerId", { setValueAs: idOrNull })}>
          <option value="">None</option>
          {options(managers)}
        </NativeSelect>
      </Field>
      <Field label="Employment type" htmlFor="employmentType">
        <NativeSelect id="employmentType" {...register("employmentType")}>
          {EMPLOYMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EMPLOYMENT_TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Work location" htmlFor="workLocation" error={errors.workLocation?.message}>
        <Input id="workLocation" {...register("workLocation")} />
      </Field>
      <Field label="Probation ends" htmlFor="probationEndDate" error={errors.probationEndDate?.message}>
        <Input id="probationEndDate" type="date" {...register("probationEndDate")} />
      </Field>
      {showConfirmation && (
        <Field label="Confirmed on" htmlFor="confirmationDate" error={errors.confirmationDate?.message}>
          <Input id="confirmationDate" type="date" {...register("confirmationDate")} />
        </Field>
      )}
      <Field label="Notice period (days)" htmlFor="noticePeriodDays" error={errors.noticePeriodDays?.message}>
        <Input id="noticePeriodDays" type="number" min={0} max={365} {...register("noticePeriodDays", { valueAsNumber: true })} />
      </Field>
    </div>
  );
}
```

`src/components/employees/bank-fields.tsx`:

```tsx
"use client";

import { useFormContext } from "react-hook-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export interface BankFormShape {
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  pan: string | null;
  aadhaar: string | null;
  passport: string | null;
}

/** `keepHint`: change-request mode, where blank fields keep the current value. */
export function BankFields({ keepHint = false }: { keepHint?: boolean }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<BankFormShape>();
  const hint = keepHint ? "Leave blank to keep the current value" : undefined;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Bank name" htmlFor="bankName" error={errors.bankName?.message} hint={hint}>
        <Input id="bankName" {...register("bankName")} />
      </Field>
      <Field label="Account number" htmlFor="bankAccount" error={errors.bankAccount?.message} hint={hint}>
        <Input id="bankAccount" inputMode="numeric" autoComplete="off" {...register("bankAccount")} />
      </Field>
      <Field label="IFSC" htmlFor="bankIfsc" error={errors.bankIfsc?.message} hint={hint}>
        <Input id="bankIfsc" autoComplete="off" {...register("bankIfsc")} />
      </Field>
      <Field label="PAN" htmlFor="pan" error={errors.pan?.message} hint={hint}>
        <Input id="pan" autoComplete="off" {...register("pan")} />
      </Field>
      <Field label="Aadhaar" htmlFor="aadhaar" error={errors.aadhaar?.message} hint={hint}>
        <Input id="aadhaar" inputMode="numeric" autoComplete="off" {...register("aadhaar")} />
      </Field>
      <Field label="Passport" htmlFor="passport" error={errors.passport?.message} hint={hint}>
        <Input id="passport" autoComplete="off" {...register("passport")} />
      </Field>
    </div>
  );
}
```

- [ ] **Step 5: Create the action** — `src/app/(app)/org/employees/actions.ts`

```ts
"use server";

import { isAllowedEmail } from "@/lib/auth/email-domain";
import { can, type Permission } from "@/lib/auth/permissions";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { defineAction } from "@/server/actions/define";
import { config } from "@/server/config";
import { DomainError } from "@/server/errors";
import { createEmployee, type LoginPlan } from "@/server/modules/employees/service";
import { generateTempPassword, hashPassword } from "@/server/modules/users/service";

const canManageLogins = (user: { permissions: readonly Permission[] }) => can(user, "user.manage") || can(user, "role.assign");

async function temporaryPassword() {
  const password = generateTempPassword();
  return { password, hash: await hashPassword(password) };
}

function assertLoginDomain(email: string | null): void {
  if (email && !isAllowedEmail(email, config.allowedEmailDomain)) {
    throw new DomainError("EMAIL_DOMAIN", `Logins need an @${config.allowedEmailDomain} work email.`, {
      workEmail: [`Must be an @${config.allowedEmailDomain} address`],
    });
  }
}

export const createEmployeeAction = defineAction({
  name: "employees.create",
  schema: createEmployeeSchema,
  permission: (user, input) => can(user, "employee.create") && (input.loginMode === "none" || canManageLogins(user)),
  prepare: async (input) => (input.loginMode === "create" ? temporaryPassword() : null),
  handler: ({ tx, user, audit }, input, temp) => {
    const { loginMode, loginRoles, linkUserId, ...employee } = input;
    if (loginMode === "create") assertLoginDomain(employee.workEmail);
    const login: LoginPlan =
      loginMode === "create"
        ? { mode: "create", roles: loginRoles, passwordHash: temp!.hash }
        : loginMode === "link"
          ? { mode: "link", userId: linkUserId! }
          : { mode: "none" };
    const row = createEmployee(tx, user, employee, { login, onboarding: true });
    const loginNote = { none: "", create: " with a new login", link: " linked to an existing login" }[loginMode];
    audit({
      action: "employee.create", entityType: "employee", entityId: row.id,
      summary: `Added ${row.employeeCode} ${row.displayName}${loginNote}`,
    });
    return {
      id: row.id,
      employeeCode: row.employeeCode,
      tempPassword: loginMode === "create" ? temp!.password : null,
      loginEmail: loginMode === "create" ? row.workEmail : null,
    };
  },
  revalidate: ["/org/employees"],
});
```

- [ ] **Step 6: The employee list** — `src/app/(app)/org/employees/employees-table.tsx`

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { filterEmployees, type StatusFilter } from "@/components/employees/filters";
import { EmployeeStatusBadge } from "@/components/employees/status-badge";
import { DataTable } from "@/components/ui/data-table";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate } from "@/lib/dates";
import { EMPLOYEE_STATUS_LABELS, EMPLOYEE_STATUSES, type SelectOption } from "@/lib/hr";
import type { EmployeeListItem } from "@/server/modules/employees/queries";

const columns: ColumnDef<EmployeeListItem>[] = [
  {
    id: "employee",
    header: "Employee",
    accessorFn: (e) => `${e.displayName} ${e.employeeCode} ${e.workEmail ?? ""}`,
    cell: ({ row }) => (
      <Link href={`/org/employees/${row.original.id}`} className="block min-w-0 hover:underline">
        <span className="font-medium">{row.original.displayName}</span>
        <span className="block text-xs text-muted-foreground">
          {row.original.employeeCode}
          {row.original.workEmail ? ` · ${row.original.workEmail}` : ""}
        </span>
      </Link>
    ),
  },
  { id: "department", header: "Department", accessorFn: (e) => e.departmentName ?? "—" },
  { id: "designation", header: "Designation", accessorFn: (e) => e.designationName ?? "—" },
  { id: "manager", header: "Manager", accessorFn: (e) => e.managerName ?? "—" },
  {
    id: "status",
    header: "Status",
    accessorFn: (e) => EMPLOYEE_STATUS_LABELS[e.status],
    cell: ({ row }) => <EmployeeStatusBadge status={row.original.status} />,
  },
  { id: "joined", header: "Joined", accessorFn: (e) => e.dateOfJoining, cell: ({ row }) => formatDate(row.original.dateOfJoining) },
];

export function EmployeesTable({ rows, departments }: { rows: EmployeeListItem[]; departments: SelectOption[] }) {
  const [status, setStatus] = useState<StatusFilter>("current");
  const [departmentId, setDepartmentId] = useState("");
  const data = filterEmployees(rows, { status, departmentId: departmentId ? Number(departmentId) : null });
  return (
    <DataTable
      columns={columns}
      data={data}
      searchPlaceholder="Search name, code or email…"
      emptyMessage="No employees match these filters."
      toolbar={
        <div className="flex flex-wrap gap-2">
          <div className="w-40">
            <NativeSelect aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
              <option value="current">Current</option>
              <option value="all">All</option>
              {EMPLOYEE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {EMPLOYEE_STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="w-48">
            <NativeSelect aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      }
    />
  );
}
```

`src/app/(app)/org/employees/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { FileUp, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listEmployees } from "@/server/modules/employees/queries";
import { departmentOptions } from "@/server/modules/org/queries";
import { EmployeesTable } from "./employees-table";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const user = await requirePermission("employee.view");
  return (
    <>
      <PageHeader
        title="Employees"
        description="Everyone on the employee master, including people on notice and leavers."
        actions={
          <>
            {can(user, "employee.import") && (
              <Button asChild variant="outline">
                <Link href="/org/import">
                  <FileUp /> Import
                </Link>
              </Button>
            )}
            {can(user, "employee.create") && (
              <Button asChild>
                <Link href="/org/employees/new">
                  <UserPlus /> Add employee
                </Link>
              </Button>
            )}
          </>
        }
      />
      <EmployeesTable rows={listEmployees(db)} departments={departmentOptions(db)} />
    </>
  );
}
```

- [ ] **Step 7: The wizard** — `src/app/(app)/org/employees/new/employee-wizard.tsx`

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Controller, FormProvider, useForm, useFormContext, type FieldErrors, type FieldPath } from "react-hook-form";
import { toast } from "sonner";
import { BankFields } from "@/components/employees/bank-fields";
import { EMPTY_ADDRESS, EMPTY_EMERGENCY_CONTACT } from "@/components/employees/form-defaults";
import { JobFields } from "@/components/employees/job-fields";
import { PersonalFields } from "@/components/employees/personal-fields";
import { idOrNull } from "@/components/forms/select-values";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { RolePicker } from "@/components/users/role-picker";
import { TempPasswordDialog } from "@/components/users/temp-password-dialog";
import type { SelectOption } from "@/lib/hr";
import { cn } from "@/lib/utils";
import { createEmployeeSchema, type CreateEmployeeFormValues, type CreateEmployeeInput } from "@/lib/validation/employees";
import { createEmployeeAction } from "../actions";

type Values = CreateEmployeeFormValues;

const STEPS: { title: string; fields: FieldPath<Values>[] }[] = [
  { title: "Basics", fields: ["firstName", "lastName", "displayName", "workEmail", "phone"] },
  {
    title: "Job",
    fields: ["employeeCode", "dateOfJoining", "departmentId", "designationId", "reportingManagerId", "employmentType", "workLocation", "probationEndDate", "noticePeriodDays"],
  },
  { title: "Personal", fields: ["dateOfBirth", "gender", "maritalStatus", "personalEmail", "address", "emergencyContact"] },
  { title: "Bank & IDs", fields: ["bankName", "bankAccount", "bankIfsc", "pan", "aadhaar", "passport"] },
  { title: "Login", fields: ["loginMode", "loginRoles", "linkUserId"] },
];
const LAST = STEPS.length - 1;

/** First step that owns one of the invalid fields (`address.city` belongs to `address`). */
function firstStepWith(invalid: string[]): number {
  return STEPS.findIndex((step) => step.fields.some((field) => invalid.some((name) => name.split(".")[0] === field)));
}

function LoginStep({
  canManageLogins,
  canAssignPrivileged,
  linkableUsers,
  allowedDomain,
}: {
  canManageLogins: boolean;
  canAssignPrivileged: boolean;
  linkableUsers: SelectOption[];
  allowedDomain: string;
}) {
  const {
    register,
    control,
    watch,
    formState: { errors },
  } = useFormContext<Values>();
  const mode = watch("loginMode");
  if (!canManageLogins) {
    return <p className="text-sm text-muted-foreground">An administrator can add a login for this employee later.</p>;
  }
  return (
    <div className="space-y-4">
      <Field label="Login" htmlFor="loginMode" hint={`Logins use the work email, which must be an @${allowedDomain} address.`}>
        <NativeSelect id="loginMode" {...register("loginMode")}>
          <option value="none">No login for now</option>
          <option value="create">Create a login with a temporary password</option>
          <option value="link">Link an existing login</option>
        </NativeSelect>
      </Field>
      {mode === "create" && (
        <Field label="Roles" error={errors.loginRoles?.message}>
          <Controller
            control={control}
            name="loginRoles"
            render={({ field }) => (
              <RolePicker value={field.value} onChange={field.onChange} canAssignPrivileged={canAssignPrivileged} idPrefix="wizard-role" />
            )}
          />
        </Field>
      )}
      {mode === "link" && (
        <Field label="Existing login" htmlFor="linkUserId" error={errors.linkUserId?.message} hint="Logins not yet linked to an employee record">
          <NativeSelect id="linkUserId" {...register("linkUserId", { setValueAs: idOrNull })}>
            <option value="">Choose a login</option>
            {linkableUsers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
    </div>
  );
}

export function EmployeeWizard({
  today,
  nextCode,
  departments,
  designations,
  managers,
  linkableUsers,
  canManageLogins,
  canAssignPrivileged,
  allowedDomain,
}: {
  today: string;
  nextCode: string;
  departments: SelectOption[];
  designations: SelectOption[];
  managers: SelectOption[];
  linkableUsers: SelectOption[];
  canManageLogins: boolean;
  canAssignPrivileged: boolean;
  allowedDomain: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [created, setCreated] = useState<{ id: number; email: string; password: string } | null>(null);
  const form = useForm<Values, unknown, CreateEmployeeInput>({
    resolver: zodResolver(createEmployeeSchema),
    mode: "onTouched",
    defaultValues: {
      firstName: "", lastName: "", displayName: "", workEmail: "", personalEmail: "", phone: "",
      dateOfBirth: "", gender: null, maritalStatus: null, address: EMPTY_ADDRESS, emergencyContact: EMPTY_EMERGENCY_CONTACT,
      departmentId: null, designationId: null, reportingManagerId: null, employmentType: "full_time", workLocation: "",
      dateOfJoining: today, probationEndDate: "", confirmationDate: "", noticePeriodDays: 30,
      bankName: "", bankAccount: "", bankIfsc: "", pan: "", aadhaar: "", passport: "",
      employeeCode: "", loginMode: "none", loginRoles: ["employee"], linkUserId: null,
    },
  });
  const { run, pending } = useServerAction(createEmployeeAction, {
    onSuccess: (data) => {
      if (data.tempPassword && data.loginEmail) {
        setCreated({ id: data.id, email: data.loginEmail, password: data.tempPassword });
      } else {
        toast.success(`Added ${data.employeeCode}`);
        router.push(`/org/employees/${data.id}`);
      }
    },
    onError: (result) => {
      applyFieldErrors(form.setError, result.fieldErrors);
      const target = firstStepWith(Object.keys(result.fieldErrors ?? {}));
      if (target >= 0) setStep(target);
    },
  });

  const next = async () => {
    if (await form.trigger(STEPS[step]!.fields)) setStep((s) => Math.min(s + 1, LAST));
  };
  const submit = form.handleSubmit(
    (values) => run(values),
    (errors: FieldErrors<Values>) => {
      const target = firstStepWith(Object.keys(errors));
      if (target >= 0) setStep(target);
    },
  );

  return (
    <FormProvider {...form}>
      <ol className="mb-6 flex flex-wrap gap-2 text-sm">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            aria-current={i === step ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-full border px-3 py-1",
              i === step ? "border-primary bg-primary-soft text-primary" : i < step ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <span className="font-semibold">{i + 1}</span>
            {s.title}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(e) => {
          if (step < LAST) {
            e.preventDefault();
            void next();
          } else {
            void submit(e);
          }
        }}
      >
        <Card>
          <CardContent className="pt-5">
            {step === 0 && <PersonalFields part="basic" />}
            {step === 1 && (
              <JobFields departments={departments} designations={designations} managers={managers} codeHint={`Leave blank to use ${nextCode}`} />
            )}
            {step === 2 && <PersonalFields part="details" />}
            {step === 3 && <BankFields />}
            {step === 4 && (
              <LoginStep
                canManageLogins={canManageLogins}
                canAssignPrivileged={canAssignPrivileged}
                linkableUsers={linkableUsers}
                allowedDomain={allowedDomain}
              />
            )}
          </CardContent>
          <CardFooter className="justify-between">
            <Button type="button" variant="outline" disabled={step === 0 || pending} onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft /> Back
            </Button>
            {step < LAST ? (
              <Button type="submit">
                Next <ArrowRight />
              </Button>
            ) : (
              <Button type="submit" disabled={pending}>
                {pending && <Spinner />}
                Create employee
              </Button>
            )}
          </CardFooter>
        </Card>
      </form>
      <TempPasswordDialog
        value={created ? { email: created.email, password: created.password } : null}
        onClose={() => {
          const id = created?.id;
          setCreated(null);
          if (id) router.push(`/org/employees/${id}`);
        }}
      />
    </FormProvider>
  );
}
```

`src/app/(app)/org/employees/new/page.tsx`:

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { todayInTimeZone } from "@/lib/dates";
import { requirePermission } from "@/server/auth/session";
import { config } from "@/server/config";
import { db } from "@/server/db";
import { nextEmployeeCode } from "@/server/modules/employees/code";
import { employeeOptions, unlinkedUserOptions } from "@/server/modules/employees/queries";
import { departmentOptions, designationOptions } from "@/server/modules/org/queries";
import { getSetting } from "@/server/modules/settings/service";
import { EmployeeWizard } from "./employee-wizard";

export const metadata: Metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const user = await requirePermission("employee.create");
  const canManageLogins = can(user, "user.manage") || can(user, "role.assign");
  return (
    <>
      <PageHeader title="Add employee" description="Basics, job, personal and bank details, then an optional login." />
      <EmployeeWizard
        today={todayInTimeZone(getSetting(db, "locale").timezone)}
        nextCode={nextEmployeeCode(db)}
        departments={departmentOptions(db)}
        designations={designationOptions(db)}
        managers={employeeOptions(db)}
        linkableUsers={canManageLogins ? unlinkedUserOptions(db) : []}
        canManageLogins={canManageLogins}
        canAssignPrivileged={can(user, "role.assign")}
        allowedDomain={config.allowedEmailDomain}
      />
    </>
  );
}
```

- [ ] **Step 8: Run to verify pass**

Run: `npx vitest run tests/unit/components tests/integration/employee-create-action.test.ts tests/integration/user-actions.test.ts && npm run typecheck && npm run lint`
Expected: PASS. The new tests (filters 1, create action 4) pass. The Phase 0 user-action tests still pass after the component move. Typecheck is clean; lint has 0 errors.

- [ ] **Step 9: Manual check**

On a throwaway dev server (see Task 13 Step 10), as the seeded admin:
- create a department and a designation;
- add an employee through all five wizard steps with "Create a login"; the temporary password dialog appears, then the browser lands on `/org/employees/<id>` (the page arrives in Task 15, so a 404 is expected until then);
- add a second employee without a login; `/org/employees` lists both with codes `PV0001`/`PV0002`;
- press Enter on the Basics step: it moves to the next step instead of submitting.

- [ ] **Step 10: Commit**

```bash
git add src/components "src/app/(app)/settings/users" "src/app/(app)/org/employees" tests/unit/components tests/integration/employee-create-action.test.ts
git commit -m "feat(employees): add employee list and create wizard"
```

---
### Task 15: Employee profile page

**Files:**
- Modify: `src/app/(app)/org/employees/actions.ts` (replace with the full set below)
- Create: `src/components/employees/{detail-list,events-timeline,checklist-card,documents-card}.tsx`
- Create: `src/app/(app)/org/employees/[id]/{page,job-form,personal-form,bank-form,login-card,exit-card}.tsx`
- Test: `tests/integration/employee-profile-actions.test.ts`

**Interfaces:**
- Consumes:
  - `getEmployeeDetail`, `listEmployeeEvents`, `employeeOptions`, `unlinkedUserOptions` (Task 8).
  - `canViewEmployee`, `isInScope`, `getReportingTree` (Task 5).
  - Employee services (Task 7), lifecycle (Task 9), documents (Task 10), checklists (Task 6).
  - Field components and `form-defaults` (Task 14); `rolesSchema` (`src/lib/validation/users.ts`, Phase 0).
- Produces:
  - Actions: `updateEmployeeJobAction`, `updateEmployeePersonalAction`, `updateEmployeeBankAction`, `recordResignationAction`, `withdrawResignationAction`, `createEmployeeLoginAction`, `linkEmployeeUserAction`, `uploadEmployeeDocumentAction` (FormData: `employeeId`, `category`, `title`, `file`), `deleteEmployeeDocumentAction`, `toggleChecklistItemAction`.
  - Components: `DetailList` + `bankDetailItems(bank)`, `EventsTimeline`, `ChecklistCard` (+ `ChecklistView`), `DocumentsCard`.
  - Page `/org/employees/[id]?tab=` for anyone with `canViewEmployee`. Everyone else gets a 404, so id guessing reveals nothing.
- Access rules:
  - Everyone who can view the profile sees Overview, Job, Documents, History and Checklists.
  - Personal and Bank & IDs are shown to the employee and to org-wide viewers.
  - Editing needs `employee.update`, and bank edits also need `employee.sensitive.view`.

- [ ] **Step 1: Write the failing tests** — `tests/integration/employee-profile-actions.test.ts`

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, employeeChecklists, employees, type EmployeeRow } from "@/server/db/schema";
import { seedDefaultChecklistTemplates } from "@/server/modules/employees/checklists";
import { listEmployeeDocuments } from "@/server/modules/employees/documents";
import { createEmployee } from "@/server/modules/employees/service";
import { createTestDb } from "../helpers/db";
import { employeeInput } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import {
  createEmployeeLoginAction, deleteEmployeeDocumentAction, linkEmployeeUserAction, recordResignationAction,
  toggleChecklistItemAction, updateEmployeeBankAction, updateEmployeeJobAction, uploadEmployeeDocumentAction,
  withdrawResignationAction,
} from "@/app/(app)/org/employees/actions";

const PDF = new Uint8Array(Buffer.from("%PDF-1.7 scanned document"));
const none = { login: { mode: "none" as const }, onboarding: false };
let dir: string;
let hr: SessionUser;
let asha: EmployeeRow;
let ravi: EmployeeRow;

/** A session for a new user, optionally linked to `employee`. */
function sessionAs(employee: EmployeeRow | null, roles: Role[] = ["employee"]): SessionUser {
  const user = insertUser(state.db, { roles });
  if (employee) state.db.update(employees).set({ userId: user.id }).where(eq(employees.id, employee.id)).run();
  return sessionUserFor(state.db, user);
}

const jobOf = (row: EmployeeRow) => ({
  departmentId: row.departmentId, designationId: row.designationId, reportingManagerId: row.reportingManagerId,
  employmentType: row.employmentType, workLocation: row.workLocation, dateOfJoining: row.dateOfJoining,
  probationEndDate: row.probationEndDate, confirmationDate: row.confirmationDate, noticePeriodDays: row.noticePeriodDays,
});

function docForm(employeeId: number, category: string, title = "Scanned copy", withFile = true): FormData {
  const form = new FormData();
  form.set("employeeId", String(employeeId));
  form.set("category", category);
  form.set("title", title);
  if (withFile) form.set("file", new File([PDF], "scan.pdf"));
  return form;
}

beforeEach(() => {
  state.db = createTestDb();
  seedDefaultChecklistTemplates(state.db);
  dir = mkdtempSync(path.join(tmpdir(), "pvcon-profile-"));
  vi.stubEnv("UPLOAD_DIR", dir);
  hr = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
  asha = createEmployee(state.db, hr, employeeInput({ workEmail: "asha@pvcon.in" }), none);
  ravi = createEmployee(
    state.db, hr,
    employeeInput({ firstName: "Ravi", lastName: "Menon", workEmail: "ravi@pvcon.in", reportingManagerId: asha.id }),
    { ...none, onboarding: true },
  );
  state.user = hr;
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("job, bank and exit actions", () => {
  it("lets HR update job details but not the employee", async () => {
    await expect(updateEmployeeJobAction({ ...jobOf(ravi), workLocation: "Pune", employeeId: ravi.id, effectiveDate: "2026-11-01" })).resolves.toMatchObject({ ok: true });
    state.user = sessionAs(ravi);
    await expect(updateEmployeeJobAction({ ...jobOf(ravi), employeeId: ravi.id, effectiveDate: "2026-11-01" })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("needs sensitive access to edit bank details and never writes them to the audit log in clear text", async () => {
    const bank = { bankName: "HDFC Bank", bankAccount: "444455556666", bankIfsc: "HDFC0001234", pan: null, aadhaar: null, passport: null };
    await expect(updateEmployeeBankAction({ ...bank, employeeId: ravi.id })).resolves.toMatchObject({ ok: true });
    expect(JSON.stringify(state.db.select().from(auditLogs).all())).not.toContain("444455556666");
    state.user = sessionAs(null, ["payroll_admin"]);
    await expect(updateEmployeeBankAction({ ...bank, employeeId: ravi.id })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("records and withdraws resignations for employee.exit holders only", async () => {
    const resignation = { employeeId: ravi.id, resignationDate: "2026-11-01", lastWorkingDate: "2026-11-30", exitReason: "" };
    await expect(recordResignationAction(resignation)).resolves.toMatchObject({ ok: true });
    await expect(withdrawResignationAction({ employeeId: ravi.id })).resolves.toMatchObject({ ok: true });
    state.user = sessionAs(asha, ["employee", "manager"]);
    await expect(recordResignationAction(resignation)).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("login actions", () => {
  it("creates a login with a temporary password, but only for an allowed work email", async () => {
    await expect(createEmployeeLoginAction({ employeeId: ravi.id, roles: ["employee"] })).resolves.toMatchObject({
      ok: true, data: { email: "ravi@pvcon.in" },
    });
    const outsider = createEmployee(state.db, hr, employeeInput({ firstName: "Out", workEmail: "out@gmail.com" }), none);
    await expect(createEmployeeLoginAction({ employeeId: outsider.id, roles: ["employee"] })).resolves.toMatchObject({ code: "EMAIL_DOMAIN" });
  });

  it("links an existing login; employees cannot", async () => {
    await expect(linkEmployeeUserAction({ employeeId: asha.id, userId: insertUser(state.db).id })).resolves.toMatchObject({ ok: true });
    state.user = sessionAs(ravi);
    await expect(linkEmployeeUserAction({ employeeId: ravi.id, userId: insertUser(state.db).id })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("document actions", () => {
  it("lets HR upload any category and employees only their own ID-type documents", async () => {
    await expect(uploadEmployeeDocumentAction(docForm(ravi.id, "offer_letter", "Offer letter"))).resolves.toMatchObject({ ok: true });
    state.user = sessionAs(ravi);
    await expect(uploadEmployeeDocumentAction(docForm(ravi.id, "id_proof", "PAN card"))).resolves.toMatchObject({ ok: true });
    await expect(uploadEmployeeDocumentAction(docForm(ravi.id, "contract"))).resolves.toMatchObject({ code: "FORBIDDEN" });
    await expect(uploadEmployeeDocumentAction(docForm(asha.id, "id_proof"))).resolves.toMatchObject({ code: "FORBIDDEN" });
    expect(listEmployeeDocuments(state.db, ravi.id).map((d) => d.title).sort()).toEqual(["Offer letter", "PAN card"]);
  });

  it("validates the title and the file", async () => {
    await expect(uploadEmployeeDocumentAction(docForm(ravi.id, "offer_letter", "x"))).resolves.toMatchObject({
      ok: false, code: "VALIDATION", fieldErrors: { title: ["At least 2 characters"] },
    });
    await expect(uploadEmployeeDocumentAction(docForm(ravi.id, "offer_letter", "Offer", false))).resolves.toMatchObject({ code: "NO_FILE" });
  });

  it("lets only document.manage holders delete", async () => {
    const uploaded = await uploadEmployeeDocumentAction(docForm(ravi.id, "offer_letter"));
    if (!uploaded.ok) throw new Error(uploaded.error);
    state.user = sessionAs(ravi);
    await expect(deleteEmployeeDocumentAction({ documentId: uploaded.data.id })).resolves.toMatchObject({ code: "FORBIDDEN" });
    state.user = hr;
    await expect(deleteEmployeeDocumentAction({ documentId: uploaded.data.id })).resolves.toMatchObject({ ok: true });
  });
});

describe("checklist action", () => {
  it("lets the employee, managers above them and HR tick items, but not a peer", async () => {
    const checklist = state.db.select().from(employeeChecklists).where(eq(employeeChecklists.employeeId, ravi.id)).get()!;
    const tick = (index: number) => toggleChecklistItemAction({ checklistId: checklist.id, index, done: true });
    state.user = sessionAs(ravi);
    await expect(tick(0)).resolves.toMatchObject({ ok: true });
    state.user = sessionAs(asha);
    await expect(tick(1)).resolves.toMatchObject({ ok: true });
    state.user = sessionAs(createEmployee(state.db, hr, employeeInput({ firstName: "Meera" }), none));
    await expect(tick(2)).resolves.toMatchObject({ code: "FORBIDDEN" });
    state.user = hr;
    await expect(tick(2)).resolves.toMatchObject({ ok: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/employee-profile-actions.test.ts`
Expected: FAIL — the actions are not exported yet.

- [ ] **Step 3: Replace `src/app/(app)/org/employees/actions.ts`**

```ts
"use server";

import { z } from "zod";
import { isAllowedEmail } from "@/lib/auth/email-domain";
import { can, type Permission } from "@/lib/auth/permissions";
import { SELF_DOCUMENT_CATEGORIES } from "@/lib/hr";
import {
  bankSchema, createEmployeeSchema, documentMetaSchema, isoDate, jobSchema, personalSchema, resignationSchema,
} from "@/lib/validation/employees";
import { rolesSchema } from "@/lib/validation/users";
import { defineAction } from "@/server/actions/define";
import { config } from "@/server/config";
import { DomainError } from "@/server/errors";
import { diffObjects } from "@/server/modules/audit/service";
import { getEmployeeChecklist, toggleChecklistItem } from "@/server/modules/employees/checklists";
import { addEmployeeDocument, deleteEmployeeDocument } from "@/server/modules/employees/documents";
import { recordResignation, withdrawResignation } from "@/server/modules/employees/lifecycle";
import { isInScope } from "@/server/modules/employees/scope";
import {
  createEmployee, createEmployeeLogin, linkEmployeeUser, requireEmployee, updateEmployeeBank, updateEmployeeJob,
  updateEmployeePersonal, type LoginPlan,
} from "@/server/modules/employees/service";
import { saveUpload } from "@/server/modules/files/service";
import { generateTempPassword, hashPassword } from "@/server/modules/users/service";

const idSchema = z.number().int().positive();
const PATHS = ["/org/employees"];
const canManageLogins = (user: { permissions: readonly Permission[] }) => can(user, "user.manage") || can(user, "role.assign");

async function temporaryPassword() {
  const password = generateTempPassword();
  return { password, hash: await hashPassword(password) };
}

function assertLoginDomain(email: string | null): void {
  if (email && !isAllowedEmail(email, config.allowedEmailDomain)) {
    throw new DomainError("EMAIL_DOMAIN", `Logins need an @${config.allowedEmailDomain} work email.`, {
      workEmail: [`Must be an @${config.allowedEmailDomain} address`],
    });
  }
}

export const createEmployeeAction = defineAction({
  name: "employees.create",
  schema: createEmployeeSchema,
  permission: (user, input) => can(user, "employee.create") && (input.loginMode === "none" || canManageLogins(user)),
  prepare: async (input) => (input.loginMode === "create" ? temporaryPassword() : null),
  handler: ({ tx, user, audit }, input, temp) => {
    const { loginMode, loginRoles, linkUserId, ...employee } = input;
    if (loginMode === "create") assertLoginDomain(employee.workEmail);
    const login: LoginPlan =
      loginMode === "create"
        ? { mode: "create", roles: loginRoles, passwordHash: temp!.hash }
        : loginMode === "link"
          ? { mode: "link", userId: linkUserId! }
          : { mode: "none" };
    const row = createEmployee(tx, user, employee, { login, onboarding: true });
    const loginNote = { none: "", create: " with a new login", link: " linked to an existing login" }[loginMode];
    audit({
      action: "employee.create", entityType: "employee", entityId: row.id,
      summary: `Added ${row.employeeCode} ${row.displayName}${loginNote}`,
    });
    return {
      id: row.id,
      employeeCode: row.employeeCode,
      tempPassword: loginMode === "create" ? temp!.password : null,
      loginEmail: loginMode === "create" ? row.workEmail : null,
    };
  },
  revalidate: PATHS,
});

export const updateEmployeeJobAction = defineAction({
  name: "employees.update_job",
  schema: jobSchema.and(z.object({ employeeId: idSchema, effectiveDate: isoDate })),
  permission: "employee.update",
  handler: ({ tx, user, audit }, { employeeId, effectiveDate, ...job }) => {
    const { before, after } = updateEmployeeJob(tx, user.id, employeeId, job, effectiveDate);
    audit({
      action: "employee.update_job", entityType: "employee", entityId: employeeId,
      summary: `Updated job details of ${after.employeeCode}`, diff: diffObjects(before, after),
    });
    return { id: employeeId };
  },
  revalidate: PATHS,
});

export const updateEmployeePersonalAction = defineAction({
  name: "employees.update_personal",
  schema: personalSchema.extend({ employeeId: idSchema }),
  permission: "employee.update",
  handler: ({ tx, audit }, { employeeId, ...personal }) => {
    const { before, after } = updateEmployeePersonal(tx, employeeId, personal);
    audit({
      action: "employee.update_personal", entityType: "employee", entityId: employeeId,
      summary: `Updated personal details of ${after.employeeCode}`, diff: diffObjects(before, after),
    });
    return { id: employeeId };
  },
  revalidate: PATHS,
});

export const updateEmployeeBankAction = defineAction({
  name: "employees.update_bank",
  schema: bankSchema.extend({ employeeId: idSchema }),
  permission: (user) => can(user, "employee.update") && can(user, "employee.sensitive.view"),
  handler: ({ tx, audit }, { employeeId, ...bank }) => {
    // Masked views only: the audit log never stores account or ID numbers.
    const { before, after } = updateEmployeeBank(tx, employeeId, bank);
    audit({
      action: "employee.update_bank", entityType: "employee", entityId: employeeId,
      summary: "Updated bank and ID details", diff: diffObjects({ ...before }, { ...after }),
    });
    return { id: employeeId };
  },
});

export const recordResignationAction = defineAction({
  name: "employees.resign",
  schema: resignationSchema.and(z.object({ employeeId: idSchema })),
  permission: "employee.exit",
  handler: ({ tx, user, audit }, { employeeId, ...resignation }) => {
    const after = recordResignation(tx, user.id, employeeId, resignation);
    audit({
      action: "employee.resign", entityType: "employee", entityId: employeeId,
      summary: `Recorded the resignation of ${after.employeeCode}; last working day ${after.lastWorkingDate}`,
    });
    return { id: employeeId };
  },
  revalidate: PATHS,
});

export const withdrawResignationAction = defineAction({
  name: "employees.withdraw_resignation",
  schema: z.object({ employeeId: idSchema }),
  permission: "employee.exit",
  handler: ({ tx, audit }, { employeeId }) => {
    const after = withdrawResignation(tx, employeeId);
    audit({
      action: "employee.withdraw_resignation", entityType: "employee", entityId: employeeId,
      summary: `Withdrew the resignation of ${after.employeeCode}`,
    });
    return { id: employeeId };
  },
  revalidate: PATHS,
});

export const createEmployeeLoginAction = defineAction({
  name: "employees.create_login",
  schema: z.object({ employeeId: idSchema, roles: rolesSchema.min(1, "Pick at least one role") }),
  permission: canManageLogins,
  prepare: temporaryPassword,
  handler: ({ tx, user, audit }, { employeeId, roles }, temp) => {
    assertLoginDomain(requireEmployee(tx, employeeId).workEmail);
    const { employee } = createEmployeeLogin(tx, user, employeeId, roles, temp.hash);
    audit({
      action: "employee.create_login", entityType: "employee", entityId: employeeId,
      summary: `Created a login for ${employee.employeeCode}`, diff: { roles: { from: null, to: roles } },
    });
    return { email: employee.workEmail!, tempPassword: temp.password };
  },
});

export const linkEmployeeUserAction = defineAction({
  name: "employees.link_user",
  schema: z.object({ employeeId: idSchema, userId: idSchema }),
  permission: canManageLogins,
  handler: ({ tx, audit }, { employeeId, userId }) => {
    const employee = linkEmployeeUser(tx, employeeId, userId);
    audit({
      action: "employee.link_user", entityType: "employee", entityId: employeeId,
      summary: `Linked login #${userId} to ${employee.employeeCode}`,
    });
    return { id: employeeId };
  },
});

/** HR (`document.manage`) uploads any category; employees upload ID-type documents for themselves only. */
export const uploadEmployeeDocumentAction = defineAction({
  name: "employees.document_upload",
  schema: z.instanceof(FormData),
  permission: (user) => can(user, "document.manage") || user.employeeId !== null,
  prepare: async (form) => {
    const meta = documentMetaSchema.safeParse({
      employeeId: form.get("employeeId"),
      category: form.get("category"),
      title: form.get("title"),
    });
    if (!meta.success) {
      throw new DomainError(
        "VALIDATION", "Please correct the highlighted fields.",
        z.flattenError(meta.error).fieldErrors as Record<string, string[]>,
      );
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DomainError("NO_FILE", "Choose a file to upload.", { file: ["Required"] });
    return { ...meta.data, name: file.name, data: Buffer.from(await file.arrayBuffer()) };
  },
  handler: ({ tx, user, audit }, _form, upload) => {
    const ownDocument = upload.employeeId === user.employeeId && SELF_DOCUMENT_CATEGORIES.includes(upload.category);
    if (!can(user, "document.manage") && !ownDocument) {
      throw new DomainError("FORBIDDEN", "You can only add your own ID, address, education, experience or other documents.");
    }
    const file = saveUpload(tx, {
      data: upload.data,
      originalName: upload.name,
      allowed: ["pdf", "png", "jpeg", "webp"],
      uploadedBy: user.id,
      uploadDir: config.uploadDir,
    });
    const doc = addEmployeeDocument(tx, {
      employeeId: upload.employeeId, category: upload.category, title: upload.title, fileId: file.id, uploadedBy: user.id,
    });
    audit({
      action: "employee.document_upload", entityType: "employee", entityId: upload.employeeId,
      summary: `Uploaded document "${upload.title}"`,
    });
    return { id: doc.id };
  },
  revalidate: ["/me/documents"],
});

export const deleteEmployeeDocumentAction = defineAction({
  name: "employees.document_delete",
  schema: z.object({ documentId: idSchema }),
  permission: "document.manage",
  handler: ({ tx, audit }, { documentId }) => {
    const doc = deleteEmployeeDocument(tx, documentId);
    audit({ action: "employee.document_delete", entityType: "employee", entityId: doc.employeeId, summary: `Deleted document "${doc.title}"` });
    return { id: documentId };
  },
  revalidate: ["/me/documents"],
});

/** HR, the employee, and managers above them may tick checklist items. */
export const toggleChecklistItemAction = defineAction({
  name: "employees.checklist_item",
  schema: z.object({ checklistId: idSchema, index: z.number().int().min(0), done: z.boolean() }),
  handler: ({ tx, user, audit }, { checklistId, index, done }) => {
    const checklist = getEmployeeChecklist(tx, checklistId);
    if (!checklist) throw new DomainError("NOT_FOUND", "Checklist not found.");
    const allowed =
      can(user, "employee.update") || user.employeeId === checklist.employeeId || isInScope(tx, user, checklist.employeeId);
    if (!allowed) throw new DomainError("FORBIDDEN", "You can't update this checklist.");
    const updated = toggleChecklistItem(tx, checklistId, index, done, { id: user.id, name: user.name });
    audit({
      action: "employee.checklist_item", entityType: "employee", entityId: checklist.employeeId,
      summary: `${done ? "Completed" : "Reopened"} "${checklist.items[index]?.label ?? "item"}" on ${checklist.name}`,
    });
    return { status: updated.status };
  },
});
```

- [ ] **Step 4: Create the shared profile components**

`src/components/employees/detail-list.tsx`:

```tsx
import type { ReactNode } from "react";
import type { BankView } from "@/server/modules/employees/sensitive";

export interface DetailItem {
  label: string;
  value: ReactNode;
}

const isEmpty = (value: ReactNode) => value === null || value === undefined || value === "" || value === false;

/** Label/value pairs; empty values show a dash. */
export function DetailList({ items, columns = 2 }: { items: DetailItem[]; columns?: 1 | 2 }) {
  return (
    <dl className={columns === 2 ? "grid gap-x-6 gap-y-4 sm:grid-cols-2" : "grid gap-y-4"}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 break-words text-sm">{isEmpty(item.value) ? <span className="text-muted-foreground">—</span> : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function bankDetailItems(bank: Pick<BankView, "bankName" | "bankAccount" | "bankIfsc" | "pan" | "aadhaar" | "passport">): DetailItem[] {
  return [
    { label: "Bank name", value: bank.bankName },
    { label: "Account number", value: bank.bankAccount },
    { label: "IFSC", value: bank.bankIfsc },
    { label: "PAN", value: bank.pan },
    { label: "Aadhaar", value: bank.aadhaar },
    { label: "Passport", value: bank.passport },
  ];
}
```

`src/components/employees/events-timeline.tsx`:

```tsx
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, isISODate } from "@/lib/dates";
import { EMPLOYEE_EVENT_LABELS, type EventValues } from "@/lib/hr";
import type { EmployeeEventView } from "@/server/modules/employees/queries";

const humanize = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

function display(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return typeof value === "string" && isISODate(value) ? formatDate(value) : String(value);
}

function Changes({ from, to }: { from: EventValues | null; to: EventValues | null }) {
  const keys = [...new Set([...Object.keys(from ?? {}), ...Object.keys(to ?? {})])];
  if (keys.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-sm">
      {keys.map((key) => (
        <li key={key}>
          <span className="text-muted-foreground">{humanize(key)}:</span> {from && key in from ? `${display(from[key])} → ` : ""}
          {display(to?.[key])}
        </li>
      ))}
    </ul>
  );
}

export function EventsTimeline({ events }: { events: EmployeeEventView[] }) {
  if (events.length === 0) {
    return <EmptyState title="No history yet" description="Joining, transfers and other job changes appear here." />;
  }
  return (
    <ol className="space-y-5 border-l pl-6">
      {events.map((event) => (
        <li key={event.id} className="relative">
          <span aria-hidden className="absolute -left-[31px] top-1.5 size-3 rounded-full border-2 border-background bg-primary" />
          <p className="text-sm font-medium">{EMPLOYEE_EVENT_LABELS[event.type]}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(event.effectiveDate)}
            {event.createdByName ? ` · by ${event.createdByName}` : ""}
          </p>
          <Changes from={event.from} to={event.to} />
          {event.note && <p className="mt-1 text-sm text-muted-foreground">{event.note}</p>}
        </li>
      ))}
    </ol>
  );
}
```

`src/components/employees/checklist-card.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { toggleChecklistItemAction } from "@/app/(app)/org/employees/actions";
import { useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { CHECKLIST_KIND_LABELS, CHECKLIST_OWNER_LABELS, type ChecklistItemState, type ChecklistKind } from "@/lib/hr";
import { cn } from "@/lib/utils";

export interface ChecklistView {
  id: number;
  name: string;
  kind: ChecklistKind;
  status: "open" | "completed" | "cancelled";
  items: ChecklistItemState[];
}

const STATUS = {
  open: { label: "In progress", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
} as const;

export function ChecklistCard({ checklist, canTick }: { checklist: ChecklistView; canTick: boolean }) {
  const router = useRouter();
  const { run, pending } = useServerAction(toggleChecklistItemAction, { onSuccess: () => router.refresh() });
  const done = checklist.items.filter((item) => item.doneAt !== null).length;
  const status = STATUS[checklist.status];
  const disabled = !canTick || pending || checklist.status === "cancelled";
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{checklist.name}</CardTitle>
          <CardDescription>
            {CHECKLIST_KIND_LABELS[checklist.kind]} · {done} of {checklist.items.length} done
          </CardDescription>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {checklist.items.map((item, index) => {
          const id = `checklist-${checklist.id}-${index}`;
          return (
            <div key={id} className="flex items-start gap-3">
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={item.doneAt !== null}
                disabled={disabled}
                onCheckedChange={(checked) => run({ checklistId: checklist.id, index, done: checked === true })}
              />
              <div className="min-w-0 flex-1">
                <Label htmlFor={id} className={cn("leading-snug", item.doneAt && "text-muted-foreground line-through")}>
                  {item.label}
                </Label>
                {item.doneByName && <p className="text-xs text-muted-foreground">Done by {item.doneByName}</p>}
              </div>
              <Badge variant="outline">{CHECKLIST_OWNER_LABELS[item.owner]}</Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

`src/components/employees/documents-card.tsx`:

```tsx
"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, Trash2, Upload } from "lucide-react";
import { deleteEmployeeDocumentAction, uploadEmployeeDocumentAction } from "@/app/(app)/org/employees/actions";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/dates";
import { DOCUMENT_CATEGORY_LABELS, type DocumentCategory } from "@/lib/hr";
import type { EmployeeDocumentView } from "@/server/modules/employees/documents";

const VIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function DocumentsCard({
  employeeId,
  documents,
  categories,
  canUpload,
  canDelete,
  timeZone,
}: {
  employeeId: number;
  documents: EmployeeDocumentView[];
  categories: readonly DocumentCategory[];
  canUpload: boolean;
  canDelete: boolean;
  timeZone: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const upload = useServerAction(uploadEmployeeDocumentAction, {
    successMessage: "Document uploaded",
    onSuccess: () => {
      formRef.current?.reset();
      router.refresh();
    },
  });
  const remove = useServerAction(deleteEmployeeDocumentAction, { successMessage: "Document deleted", onSuccess: () => router.refresh() });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Documents</CardTitle>
        <CardDescription>PDF, PNG, JPG or WebP, up to 10 MB each.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {canUpload && (
          <form
            ref={formRef}
            className="grid items-end gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              data.set("employeeId", String(employeeId));
              void upload.run(data);
            }}
          >
            <Field label="Category" htmlFor="doc-category">
              <NativeSelect id="doc-category" name="category" defaultValue={categories[0]}>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {DOCUMENT_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Title" htmlFor="doc-title">
              <Input id="doc-title" name="title" required minLength={2} maxLength={120} />
            </Field>
            <Field label="File" htmlFor="doc-file">
              <Input id="doc-file" name="file" type="file" required accept="application/pdf,image/png,image/jpeg,image/webp" />
            </Field>
            <Button type="submit" disabled={upload.pending}>
              {upload.pending ? <Spinner /> : <Upload />} Upload
            </Button>
          </form>
        )}
        {documents.length === 0 ? (
          <EmptyState title="No documents yet" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Title</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium">{doc.title}</TableCell>
                  <TableCell>{DOCUMENT_CATEGORY_LABELS[doc.category]}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {doc.originalName} · {formatSize(doc.size)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTime(doc.createdAt, timeZone)}
                    {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ""}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {VIEWABLE.has(doc.mime) && (
                        <Button asChild variant="ghost" size="icon">
                          <a href={`/api/files/${doc.fileId}?inline=1`} target="_blank" rel="noreferrer" aria-label={`View ${doc.title}`}>
                            <Eye />
                          </a>
                        </Button>
                      )}
                      <Button asChild variant="ghost" size="icon">
                        <a href={`/api/files/${doc.fileId}`} aria-label={`Download ${doc.title}`}>
                          <Download />
                        </a>
                      </Button>
                      {canDelete && (
                        <ConfirmDialog
                          trigger={
                            <Button variant="ghost" size="icon" aria-label={`Delete ${doc.title}`}>
                              <Trash2 />
                            </Button>
                          }
                          title="Delete document?"
                          description={`"${doc.title}" is removed from this employee's documents.`}
                          confirmLabel="Delete"
                          destructive
                          onConfirm={() => remove.run({ documentId: doc.id })}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Create the profile forms and cards** (all in `src/app/(app)/org/employees/[id]/`)

`job-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import { z } from "zod";
import { JobFields } from "@/components/employees/job-fields";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { SelectOption } from "@/lib/hr";
import { isoDate, jobSchema } from "@/lib/validation/employees";
import { updateEmployeeJobAction } from "../actions";

const schema = jobSchema.and(z.object({ effectiveDate: isoDate }));
type FormInput = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export function JobForm({
  employeeId,
  initial,
  today,
  departments,
  designations,
  managers,
}: {
  employeeId: number;
  initial: Omit<FormInput, "effectiveDate">;
  today: string;
  departments: SelectOption[];
  designations: SelectOption[];
  managers: SelectOption[];
}) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { ...initial, effectiveDate: today },
  });
  const { run, pending } = useServerAction(updateEmployeeJobAction, {
    successMessage: "Job details saved",
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit((values) => run({ ...values, employeeId }))}>
        <Card>
          <CardContent className="space-y-4 pt-5">
            <JobFields departments={departments} designations={designations} managers={managers} showConfirmation />
            <Field
              label="Changes take effect on"
              htmlFor="effectiveDate"
              error={form.formState.errors.effectiveDate?.message}
              hint="Dates the history entry for department, designation or manager changes"
              className="max-w-xs"
            >
              <Input id="effectiveDate" type="date" {...form.register("effectiveDate")} />
            </Field>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Save job details
            </Button>
          </CardFooter>
        </Card>
      </form>
    </FormProvider>
  );
}
```

`personal-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import type { z } from "zod";
import { PersonalFields } from "@/components/employees/personal-fields";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { personalSchema } from "@/lib/validation/employees";
import { updateEmployeePersonalAction } from "../actions";

type FormInput = z.input<typeof personalSchema>;
type FormOutput = z.output<typeof personalSchema>;

export function PersonalForm({ employeeId, initial }: { employeeId: number; initial: FormInput }) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(personalSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateEmployeePersonalAction, {
    successMessage: "Personal details saved",
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit((values) => run({ ...values, employeeId }))}>
        <Card>
          <CardContent className="pt-5">
            <PersonalFields part="all" />
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Save personal details
            </Button>
          </CardFooter>
        </Card>
      </form>
    </FormProvider>
  );
}
```

`bank-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import type { z } from "zod";
import { BankFields } from "@/components/employees/bank-fields";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { bankSchema } from "@/lib/validation/employees";
import { updateEmployeeBankAction } from "../actions";

type FormInput = z.input<typeof bankSchema>;
type FormOutput = z.output<typeof bankSchema>;

export function BankForm({ employeeId, initial }: { employeeId: number; initial: FormInput }) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(bankSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateEmployeeBankAction, {
    successMessage: "Bank details saved",
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit((values) => run({ ...values, employeeId }))}>
        <Card>
          <CardContent className="pt-5">
            <BankFields />
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Save bank details
            </Button>
          </CardFooter>
        </Card>
      </form>
    </FormProvider>
  );
}
```

`login-card.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useServerAction } from "@/components/forms/use-server-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { RolePicker } from "@/components/users/role-picker";
import { TempPasswordDialog } from "@/components/users/temp-password-dialog";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import type { SelectOption } from "@/lib/hr";
import { createEmployeeLoginAction, linkEmployeeUserAction } from "../actions";

export function LoginCard({
  employeeId,
  hasWorkEmail,
  user,
  canManage,
  canAssignPrivileged,
  linkableUsers,
}: {
  employeeId: number;
  hasWorkEmail: boolean;
  user: { email: string; status: "active" | "disabled"; roles: Role[] } | null;
  canManage: boolean;
  canAssignPrivileged: boolean;
  linkableUsers: SelectOption[];
}) {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>(["employee"]);
  const [linkId, setLinkId] = useState("");
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const create = useServerAction(createEmployeeLoginAction, {
    onSuccess: (data) => {
      setTemp({ email: data.email, password: data.tempPassword });
      router.refresh();
    },
  });
  const link = useServerAction(linkEmployeeUserAction, { successMessage: "Login linked", onSuccess: () => router.refresh() });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Login</CardTitle>
        <CardDescription>{user ? "This employee can sign in." : "No login yet."}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {user ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium">{user.email}</p>
            <div className="flex flex-wrap gap-1">
              {user.roles.map((role) => (
                <Badge key={role}>{ROLE_LABELS[role]}</Badge>
              ))}
              {user.status === "disabled" && <Badge variant="secondary">Disabled</Badge>}
            </div>
            {canManage && (
              <Link href="/settings/users" className="text-primary hover:underline">
                Manage in Users &amp; roles
              </Link>
            )}
          </div>
        ) : canManage ? (
          <>
            <div className="space-y-2">
              <p className="text-sm font-medium">Create a login</p>
              {hasWorkEmail ? (
                <>
                  <RolePicker value={roles} onChange={setRoles} canAssignPrivileged={canAssignPrivileged} idPrefix="login-role" />
                  <Button size="sm" disabled={create.pending || roles.length === 0} onClick={() => create.run({ employeeId, roles })}>
                    {create.pending && <Spinner />}
                    Create login
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Add a work email on the Personal tab first.</p>
              )}
            </div>
            {linkableUsers.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="link-user">Or link an existing login</Label>
                <NativeSelect id="link-user" value={linkId} onChange={(e) => setLinkId(e.target.value)}>
                  <option value="">Choose a login</option>
                  {linkableUsers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </NativeSelect>
                <Button size="sm" variant="outline" disabled={!linkId || link.pending} onClick={() => link.run({ employeeId, userId: Number(linkId) })}>
                  Link login
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">An administrator can create one.</p>
        )}
      </CardContent>
      <TempPasswordDialog value={temp} onClose={() => setTemp(null)} />
    </Card>
  );
}
```

`exit-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { LogOut } from "lucide-react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { DetailList } from "@/components/employees/detail-list";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { addDays, formatDate } from "@/lib/dates";
import type { EmployeeStatus } from "@/lib/hr";
import { resignationSchema } from "@/lib/validation/employees";
import { recordResignationAction, withdrawResignationAction } from "../actions";

type FormInput = z.input<typeof resignationSchema>;
type FormOutput = z.output<typeof resignationSchema>;

export function ExitCard({
  employeeId,
  status,
  resignationDate,
  lastWorkingDate,
  exitReason,
  noticePeriodDays,
  today,
  canExit,
}: {
  employeeId: number;
  status: EmployeeStatus;
  resignationDate: string | null;
  lastWorkingDate: string | null;
  exitReason: string | null;
  noticePeriodDays: number;
  today: string;
  canExit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(resignationSchema),
    defaultValues: { resignationDate: today, lastWorkingDate: addDays(today, noticePeriodDays), exitReason: "" },
  });
  const resign = useServerAction(recordResignationAction, {
    successMessage: "Resignation recorded",
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const withdraw = useServerAction(withdrawResignationAction, { successMessage: "Resignation withdrawn", onSuccess: () => router.refresh() });
  const errors = form.formState.errors;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Exit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {status === "active" ? (
          <>
            <p className="text-muted-foreground">Notice period: {noticePeriodDays} days.</p>
            {canExit && (
              <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
                <LogOut /> Record resignation
              </Button>
            )}
          </>
        ) : (
          <DetailList
            columns={1}
            items={[
              { label: "Resigned on", value: resignationDate && formatDate(resignationDate) },
              { label: "Last working day", value: lastWorkingDate && formatDate(lastWorkingDate) },
              { label: "Reason", value: exitReason },
            ]}
          />
        )}
        {status === "on_notice" && canExit && (
          <ConfirmDialog
            trigger={
              <Button variant="outline" size="sm">
                Withdraw resignation
              </Button>
            }
            title="Withdraw the resignation?"
            description="The employee becomes active again and the open offboarding checklist is cancelled."
            confirmLabel="Withdraw"
            onConfirm={() => withdraw.run({ employeeId })}
          />
        )}
        {status === "exited" && <p className="text-muted-foreground">Their login was disabled the day after their last working day.</p>}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record resignation</DialogTitle>
            <DialogDescription>The employee goes on notice and exits automatically the day after their last working day.</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit((values) => resign.run({ ...values, employeeId }))} className="space-y-4">
            <Field label="Resignation date" htmlFor="resignationDate" error={errors.resignationDate?.message}>
              <Input id="resignationDate" type="date" {...form.register("resignationDate")} />
            </Field>
            <Field label="Last working day" htmlFor="lastWorkingDate" error={errors.lastWorkingDate?.message}>
              <Input id="lastWorkingDate" type="date" {...form.register("lastWorkingDate")} />
            </Field>
            <Field label="Reason" htmlFor="exitReason" error={errors.exitReason?.message}>
              <Textarea id="exitReason" rows={3} {...form.register("exitReason")} />
            </Field>
            <DialogFooter>
              <Button type="submit" disabled={resign.pending}>
                {resign.pending && <Spinner />}
                Record resignation
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

- [ ] **Step 6: Create the page** — `src/app/(app)/org/employees/[id]/page.tsx`

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase, CalendarClock, Landmark, Timer } from "lucide-react";
import { ChecklistCard } from "@/components/employees/checklist-card";
import { bankDetailItems, DetailList } from "@/components/employees/detail-list";
import { DocumentsCard } from "@/components/employees/documents-card";
import { EventsTimeline } from "@/components/employees/events-timeline";
import { bankDefaults, jobDefaults, personalDefaults } from "@/components/employees/form-defaults";
import { EmployeeStatusBadge } from "@/components/employees/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can } from "@/lib/auth/permissions";
import { formatDate, todayInTimeZone } from "@/lib/dates";
import {
  DOCUMENT_CATEGORIES, EMPLOYMENT_TYPE_LABELS, formatAddress, GENDER_LABELS, MARITAL_STATUS_LABELS, type SelectOption,
} from "@/lib/hr";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { listEmployeeChecklists } from "@/server/modules/employees/checklists";
import { listEmployeeDocuments } from "@/server/modules/employees/documents";
import { employeeOptions, getEmployeeDetail, listEmployeeEvents, unlinkedUserOptions } from "@/server/modules/employees/queries";
import { canViewEmployee, getReportingTree, isInScope } from "@/server/modules/employees/scope";
import { departmentOptions, designationOptions } from "@/server/modules/org/queries";
import { getSetting } from "@/server/modules/settings/service";
import { BankForm } from "./bank-form";
import { ExitCard } from "./exit-card";
import { JobForm } from "./job-form";
import { LoginCard } from "./login-card";
import { PersonalForm } from "./personal-form";

export const metadata: Metadata = { title: "Employee" };

/** Keeps the employee's current value selectable even when it is archived or has left. */
function withCurrent(options: SelectOption[], id: number | null, label: string | null): SelectOption[] {
  if (id === null || options.some((o) => o.id === id)) return options;
  return [...options, { id, label: `${label ?? "Unknown"} (inactive)` }];
}

export default async function EmployeeProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const id = Number((await params).id);
  // Out-of-scope ids look exactly like missing ones.
  if (!Number.isInteger(id) || id <= 0 || !canViewEmployee(db, user, id)) notFound();
  const reveal = can(user, "employee.sensitive.view");
  const employee = getEmployeeDetail(db, id, { revealSensitive: reveal });
  if (!employee) notFound();

  const isSelf = user.employeeId === id;
  const showPrivate = isSelf || can(user, "employee.view");
  const canEdit = can(user, "employee.update") && employee.status !== "exited";
  const canManageLogins = can(user, "user.manage") || can(user, "role.assign");
  const canTick = can(user, "employee.update") || isSelf || isInScope(db, user, id);
  const timeZone = getSetting(db, "locale").timezone;
  const today = todayInTimeZone(timeZone);
  const excluded = new Set([id, ...getReportingTree(db, id)]);
  const checklists = listEmployeeChecklists(db, id);

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "job", label: "Job" },
    ...(showPrivate ? [{ value: "personal", label: "Personal" }, { value: "bank", label: "Bank & IDs" }] : []),
    { value: "documents", label: "Documents" },
    ...(can(user, "salary.view") ? [{ value: "salary", label: "Salary" }] : []),
    { value: "attendance", label: "Attendance" },
    { value: "leave", label: "Leave" },
    { value: "timesheets", label: "Timesheets" },
    { value: "history", label: "History" },
    { value: "checklists", label: "Checklists" },
  ];
  const { tab } = await searchParams;
  const active = tab && tabs.some((t) => t.value === tab) ? tab : "overview";

  const jobItems = [
    { label: "Department", value: employee.departmentName },
    { label: "Designation", value: employee.designationName },
    { label: "Reporting manager", value: employee.managerName },
    { label: "Employment type", value: EMPLOYMENT_TYPE_LABELS[employee.employmentType] },
    { label: "Work location", value: employee.workLocation },
    { label: "Joined", value: formatDate(employee.dateOfJoining) },
    { label: "Probation ends", value: employee.probationEndDate && formatDate(employee.probationEndDate) },
    { label: "Confirmed on", value: employee.confirmationDate && formatDate(employee.confirmationDate) },
    { label: "Notice period", value: `${employee.noticePeriodDays} days` },
  ];
  const contact = employee.emergencyContact;

  return (
    <>
      <PageHeader
        title={employee.displayName}
        description={[employee.employeeCode, employee.designationName, employee.departmentName].filter(Boolean).join(" · ")}
        actions={<EmployeeStatusBadge status={employee.status} />}
      />
      <Tabs defaultValue={active}>
        <TabsList className="h-auto flex-wrap justify-start">
          {tabs.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  { label: "Employee code", value: employee.employeeCode },
                  { label: "Work email", value: employee.workEmail },
                  { label: "Phone", value: employee.phone },
                  { label: "Department", value: employee.departmentName },
                  { label: "Designation", value: employee.designationName },
                  {
                    label: "Reporting manager",
                    value: employee.reportingManagerId ? (
                      <Link className="text-primary hover:underline" href={`/org/employees/${employee.reportingManagerId}`}>
                        {employee.managerName}
                      </Link>
                    ) : null,
                  },
                  { label: "Employment type", value: EMPLOYMENT_TYPE_LABELS[employee.employmentType] },
                  { label: "Joined", value: formatDate(employee.dateOfJoining) },
                ]}
              />
              {employee.directReports.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2 text-sm font-medium">Direct reports</p>
                  <ul className="flex flex-wrap gap-2">
                    {employee.directReports.map((report) => (
                      <li key={report.id}>
                        <Link href={`/org/employees/${report.id}`} className="rounded-full border px-3 py-1 text-sm hover:bg-muted">
                          {report.displayName}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
          <div className="space-y-6">
            <LoginCard
              employeeId={id}
              hasWorkEmail={employee.workEmail !== null}
              user={employee.user}
              canManage={canManageLogins && employee.status !== "exited"}
              canAssignPrivileged={can(user, "role.assign")}
              linkableUsers={canManageLogins ? unlinkedUserOptions(db) : []}
            />
            <ExitCard
              employeeId={id}
              status={employee.status}
              resignationDate={employee.resignationDate}
              lastWorkingDate={employee.lastWorkingDate}
              exitReason={employee.exitReason}
              noticePeriodDays={employee.noticePeriodDays}
              today={today}
              canExit={can(user, "employee.exit")}
            />
          </div>
        </TabsContent>

        <TabsContent value="job">
          {canEdit ? (
            <JobForm
              employeeId={id}
              initial={jobDefaults(employee)}
              today={today}
              departments={withCurrent(departmentOptions(db), employee.departmentId, employee.departmentName)}
              designations={withCurrent(designationOptions(db), employee.designationId, employee.designationName)}
              managers={withCurrent(
                employeeOptions(db).filter((o) => !excluded.has(o.id)),
                employee.reportingManagerId,
                employee.managerName,
              )}
            />
          ) : (
            <Card>
              <CardContent className="pt-5">
                <DetailList items={jobItems} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {showPrivate && (
          <TabsContent value="personal">
            {canEdit ? (
              <PersonalForm employeeId={id} initial={personalDefaults(employee)} />
            ) : (
              <Card>
                <CardContent className="pt-5">
                  <DetailList
                    items={[
                      { label: "Date of birth", value: employee.dateOfBirth && formatDate(employee.dateOfBirth) },
                      { label: "Gender", value: employee.gender && GENDER_LABELS[employee.gender] },
                      { label: "Marital status", value: employee.maritalStatus && MARITAL_STATUS_LABELS[employee.maritalStatus] },
                      { label: "Personal email", value: employee.personalEmail },
                      { label: "Phone", value: employee.phone },
                      { label: "Address", value: formatAddress(employee.address) },
                      { label: "Emergency contact", value: contact && [contact.name, contact.relation, contact.phone].filter(Boolean).join(" · ") },
                    ]}
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {showPrivate && (
          <TabsContent value="bank">
            {canEdit && reveal ? (
              <BankForm employeeId={id} initial={bankDefaults(employee.bank)} />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Bank &amp; IDs</CardTitle>
                  <CardDescription>
                    {employee.bank.masked ? "Numbers are masked. Employees request changes from My profile." : "Shown in full."}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DetailList items={bankDetailItems(employee.bank)} />
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        <TabsContent value="documents">
          <DocumentsCard
            employeeId={id}
            documents={listEmployeeDocuments(db, id)}
            categories={DOCUMENT_CATEGORIES}
            canUpload={can(user, "document.manage")}
            canDelete={can(user, "document.manage")}
            timeZone={timeZone}
          />
        </TabsContent>

        {can(user, "salary.view") && (
          <TabsContent value="salary">
            <EmptyState icon={Landmark} title="Salary arrives with payroll" description="Salary history and revisions are available after Phase 5." />
          </TabsContent>
        )}
        <TabsContent value="attendance">
          <EmptyState icon={CalendarClock} title="Attendance arrives in Phase 3" description="Daily attendance, punches and regularizations will show here." />
        </TabsContent>
        <TabsContent value="leave">
          <EmptyState icon={Briefcase} title="Leave arrives in Phase 2" description="Leave balances and requests will show here." />
        </TabsContent>
        <TabsContent value="timesheets">
          <EmptyState icon={Timer} title="Timesheets arrive in Phase 4" description="Weekly timesheets will show here." />
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardContent className="pt-5">
              <EventsTimeline events={listEmployeeEvents(db, id)} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="checklists" className="space-y-4">
          {checklists.length === 0 ? (
            <EmptyState title="No checklists" description="Onboarding starts when an employee is added; offboarding when a resignation is recorded." />
          ) : (
            checklists.map((c) => (
              <ChecklistCard key={c.id} checklist={{ id: c.id, name: c.name, kind: c.kind, status: c.status, items: c.items }} canTick={canTick} />
            ))
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
```

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run tests/integration/employee-profile-actions.test.ts tests/integration/employee-create-action.test.ts && npm run typecheck && npm run lint`
Expected: PASS. The 9 new tests pass and the Task 14 action tests still pass. Typecheck is clean; lint has 0 errors.

- [ ] **Step 8: Manual check**

On a throwaway dev server, as the seeded admin, with one employee who has a login and one who reports to them:
- every tab renders, and `?tab=job` opens the Job tab;
- saving the Job tab with a new department adds a "Department changed" entry to History;
- the Bank & IDs form saves, and reopening it shows the new values;
- upload a PDF on Documents, then View and Download it;
- tick an onboarding item (it records "Done by System Admin");
- record a resignation (status badge → On notice, an offboarding checklist appears), then withdraw it;
- sign in as the report: `/org/employees/<manager id>` shows 404 (not in scope), and their own profile shows masked bank numbers.

- [ ] **Step 9: Commit**

```bash
git add src/components/employees "src/app/(app)/org/employees" tests/integration/employee-profile-actions.test.ts
git commit -m "feat(employees): add the employee profile with tabs, edits, exit, documents and checklists"
```

---

### Task 16: Directory and org chart

**Files:**
- Modify: `src/components/employees/filters.ts` (add `filterDirectory`), `tests/unit/components/employee-filters.test.ts`
- Create: `src/components/employees/org-tree.tsx`
- Create: `src/app/(app)/org/directory/{page,directory-client}.tsx`, `src/app/(app)/org/chart/page.tsx`

**Interfaces:**
- Consumes: `listDirectory`, `buildOrgChart`, `DirectoryEntry`, `OrgChartNode` (Task 8); `viewableEmployeeIds` (Task 5); `departmentOptions` (Task 3); `Avatar` (Phase 0).
- Produces:
  - `filterDirectory(rows, { query, departmentId })`: every search term must match the name, code, email or designation.
  - `OrgTree({ nodes, profileIds })`.
  - Pages `/org/directory` and `/org/chart` (`directory.view`). Names link to profiles only when the viewer may open them.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/components/employee-filters.test.ts` (add `filterDirectory` to the import)

```ts
describe("filterDirectory", () => {
  const people = [
    { id: 1, displayName: "Asha Rao", employeeCode: "PV0001", workEmail: "asha@pvcon.in", designationName: "Consultant", departmentId: 1 },
    { id: 2, displayName: "Ravi Menon", employeeCode: "PV0002", workEmail: null, designationName: "Analyst", departmentId: 2 },
  ];

  it("matches every search term against name, code, email and designation", () => {
    expect(ids(filterDirectory(people, { query: "", departmentId: null }))).toEqual([1, 2]);
    expect(ids(filterDirectory(people, { query: "rao pv0001", departmentId: null }))).toEqual([1]);
    expect(ids(filterDirectory(people, { query: "ANALYST", departmentId: null }))).toEqual([2]);
    expect(ids(filterDirectory(people, { query: "asha", departmentId: 2 }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/components/employee-filters.test.ts`
Expected: FAIL — `filterDirectory` is not exported.

- [ ] **Step 3: Add `filterDirectory`** — append to `src/components/employees/filters.ts`

```ts
export function filterDirectory<
  T extends { displayName: string; employeeCode: string; workEmail: string | null; designationName: string | null; departmentId: number | null },
>(rows: T[], filter: { query: string; departmentId: number | null }): T[] {
  const terms = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    if (filter.departmentId !== null && row.departmentId !== filter.departmentId) return false;
    const haystack = [row.displayName, row.employeeCode, row.workEmail ?? "", row.designationName ?? ""].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
```

- [ ] **Step 4: The directory** — `src/app/(app)/org/directory/directory-client.tsx`

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { Mail, Phone } from "lucide-react";
import { filterDirectory } from "@/components/employees/filters";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { SelectOption } from "@/lib/hr";
import type { DirectoryEntry } from "@/server/modules/employees/queries";

export function DirectoryClient({
  entries,
  departments,
  profileIds,
}: {
  entries: DirectoryEntry[];
  departments: SelectOption[];
  profileIds: number[];
}) {
  const [query, setQuery] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const visible = filterDirectory(entries, { query, departmentId: departmentId ? Number(departmentId) : null });
  const canOpen = new Set(profileIds);

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, code, email or designation…"
          aria-label="Search the directory"
          className="max-w-sm"
        />
        <div className="w-56">
          <NativeSelect aria-label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {visible.length === 0 ? (
        <EmptyState title="Nobody matches" description="Try another name or department." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((person) => (
            <Card key={person.id}>
              <CardContent className="flex gap-3 pt-5">
                <Avatar name={person.displayName} className="size-10" />
                <div className="min-w-0 space-y-1 text-sm">
                  <p className="font-medium">
                    {canOpen.has(person.id) ? (
                      <Link href={`/org/employees/${person.id}`} className="hover:underline">
                        {person.displayName}
                      </Link>
                    ) : (
                      person.displayName
                    )}
                  </p>
                  <p className="text-muted-foreground">
                    {[person.designationName, person.departmentName].filter(Boolean).join(" · ") || person.employeeCode}
                  </p>
                  {person.workEmail && (
                    <a href={`mailto:${person.workEmail}`} className="flex items-center gap-1.5 truncate text-primary hover:underline">
                      <Mail className="size-3.5 shrink-0" />
                      {person.workEmail}
                    </a>
                  )}
                  {person.phone && (
                    <a href={`tel:${person.phone}`} className="flex items-center gap-1.5 hover:underline">
                      <Phone className="size-3.5 shrink-0" />
                      {person.phone}
                    </a>
                  )}
                  {person.managerName && <p className="text-xs text-muted-foreground">Reports to {person.managerName}</p>}
                  {person.status === "on_notice" && <Badge variant="warning">On notice</Badge>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
```

`src/app/(app)/org/directory/page.tsx`:

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listDirectory } from "@/server/modules/employees/queries";
import { viewableEmployeeIds } from "@/server/modules/employees/scope";
import { departmentOptions } from "@/server/modules/org/queries";
import { DirectoryClient } from "./directory-client";

export const metadata: Metadata = { title: "Directory" };

export default async function DirectoryPage() {
  const user = await requirePermission("directory.view");
  const entries = listDirectory(db);
  const viewable = viewableEmployeeIds(db, user);
  return (
    <>
      <PageHeader title="Directory" description="Everyone currently at PVCON." />
      <DirectoryClient
        entries={entries}
        departments={departmentOptions(db)}
        profileIds={viewable === "all" ? entries.map((e) => e.id) : viewable}
      />
    </>
  );
}
```

- [ ] **Step 5: The org chart** — `src/components/employees/org-tree.tsx`

```tsx
import Link from "next/link";
import type { OrgChartNode } from "@/server/modules/employees/queries";

function NodeCard({ node, canOpen }: { node: OrgChartNode; canOpen: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border bg-card px-3 py-2">
      <span className="text-sm font-medium">
        {canOpen ? (
          <Link href={`/org/employees/${node.id}`} className="hover:underline">
            {node.displayName}
          </Link>
        ) : (
          node.displayName
        )}
      </span>
      <span className="text-xs text-muted-foreground">{[node.designationName, node.departmentName].filter(Boolean).join(" · ")}</span>
      {node.reports.length > 0 && <span className="text-xs text-muted-foreground">{node.reports.length} direct report(s)</span>}
    </span>
  );
}

/** Nested reporting lines; the first two levels start expanded. Pure server component (native <details>). */
export function OrgTree({ nodes, profileIds, depth = 0 }: { nodes: OrgChartNode[]; profileIds: "all" | Set<number>; depth?: number }) {
  const canOpen = (id: number) => profileIds === "all" || profileIds.has(id);
  return (
    <ul className={depth === 0 ? "space-y-2" : "mt-2 space-y-2 border-l pl-5"}>
      {nodes.map((node) => (
        <li key={node.id}>
          {node.reports.length > 0 ? (
            <details open={depth < 2}>
              <summary className="cursor-pointer list-none">
                <NodeCard node={node} canOpen={canOpen(node.id)} />
              </summary>
              <OrgTree nodes={node.reports} profileIds={profileIds} depth={depth + 1} />
            </details>
          ) : (
            <NodeCard node={node} canOpen={canOpen(node.id)} />
          )}
        </li>
      ))}
    </ul>
  );
}
```

`src/app/(app)/org/chart/page.tsx`:

```tsx
import type { Metadata } from "next";
import { Network } from "lucide-react";
import { OrgTree } from "@/components/employees/org-tree";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { buildOrgChart } from "@/server/modules/employees/queries";
import { viewableEmployeeIds } from "@/server/modules/employees/scope";

export const metadata: Metadata = { title: "Org chart" };

export default async function OrgChartPage() {
  const user = await requirePermission("directory.view");
  const nodes = buildOrgChart(db);
  const viewable = viewableEmployeeIds(db, user);
  return (
    <>
      <PageHeader title="Org chart" description="Reporting lines of everyone currently at PVCON. Click a name to expand or collapse." />
      {nodes.length === 0 ? (
        <EmptyState icon={Network} title="No employees yet" description="The chart fills in as HR adds employees and reporting managers." />
      ) : (
        <OrgTree nodes={nodes} profileIds={viewable === "all" ? "all" : new Set(viewable)} />
      )}
    </>
  );
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/unit/components && npm run typecheck && npm run lint`
Expected: PASS (filters 2 tests), typecheck is clean, lint has 0 errors.

- [ ] **Step 7: Manual check**

On a throwaway dev server with three employees (A manages B, B manages C):
- the directory filters by name and department;
- as an employee without a manager role, only your own card links to a profile;
- the chart nests A → B → C and collapses on click.

- [ ] **Step 8: Commit**

```bash
git add src/components/employees "src/app/(app)/org/directory" "src/app/(app)/org/chart" tests/unit/components/employee-filters.test.ts
git commit -m "feat(org): add employee directory and org chart"
```

---
### Task 17: Self-service profile and documents

**Files:**
- Create: `src/app/(app)/me/profile/{page,contact-form,bank-change-card}.tsx`, `src/app/(app)/me/profile/actions.ts`, `src/app/(app)/me/documents/page.tsx`
- Test: `tests/integration/self-service-actions.test.ts`

**Interfaces:**
- Consumes:
  - `updateOwnContact` (Task 7); `submitProfileChange`, `withdrawProfileChange`, `pendingProfileChangeFor` (Task 11); `bankView` (Task 4); `getEmployeeDetail` (Task 8).
  - `PersonalFields`, `BankFields`, `EMPTY_*` (Task 14); `DetailList`, `bankDetailItems`, `DocumentsCard` (Task 15); `contactSchema`, `bankChangeRequestSchema` (Task 1).
- Produces:
  - Actions `updateOwnContactAction`, `submitBankChangeAction`, `withdrawBankChangeAction`. Their permission is "the login is linked to an employee record", and each acts only on `user.employeeId`.
  - Pages `/me/profile` and `/me/documents`, with an empty state for logins without an employee record.

- [ ] **Step 1: Write the failing tests** — `tests/integration/self-service-actions.test.ts`

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, employees, type EmployeeRow, type UserRow } from "@/server/db/schema";
import { pendingProfileChangeFor, submitProfileChange } from "@/server/modules/employees/profile-changes";
import { createEmployee } from "@/server/modules/employees/service";
import { createTestDb } from "../helpers/db";
import { employeeInput } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { submitBankChangeAction, updateOwnContactAction, withdrawBankChangeAction } from "@/app/(app)/me/profile/actions";

const request = (patch: Record<string, string> = {}) => ({
  bankName: "", bankAccount: "444455556666", bankIfsc: "HDFC0001234", pan: "", aadhaar: "", passport: "", reason: "New salary account",
  ...patch,
});

let hr: SessionUser;
let ashaUser: UserRow;
let asha: EmployeeRow;

beforeEach(() => {
  state.db = createTestDb();
  hr = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
  ashaUser = insertUser(state.db, { roles: ["employee"] });
  asha = createEmployee(state.db, hr, employeeInput({ bankAccount: "111122223333" }), {
    login: { mode: "link", userId: ashaUser.id }, onboarding: false,
  });
  state.user = sessionUserFor(state.db, ashaUser);
});

describe("updateOwnContactAction", () => {
  it("updates the caller's own contact details, audited", async () => {
    await expect(
      updateOwnContactAction({ personalEmail: "asha@example.com", phone: "+91 98450 12345", address: null, emergencyContact: null }),
    ).resolves.toMatchObject({ ok: true });
    expect(state.db.select().from(employees).where(eq(employees.id, asha.id)).get()).toMatchObject({
      phone: "+91 98450 12345", personalEmail: "asha@example.com",
    });
    expect(state.db.select().from(auditLogs).all().map((a) => a.action)).toEqual(["employee.update_contact"]);
  });

  it("refuses logins that have no employee record", async () => {
    state.user = hr;
    await expect(updateOwnContactAction({ personalEmail: "", phone: "", address: null, emergencyContact: null })).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("bank change requests", () => {
  it("sends one request at a time, can be withdrawn, and keeps numbers out of the audit log", async () => {
    const sent = await submitBankChangeAction(request());
    if (!sent.ok) throw new Error(sent.error);
    await expect(submitBankChangeAction(request())).resolves.toMatchObject({ code: "PENDING_EXISTS" });
    await expect(withdrawBankChangeAction({ requestId: sent.data.id })).resolves.toMatchObject({ ok: true });
    expect(pendingProfileChangeFor(state.db, asha.id)).toBeUndefined();
    expect(JSON.stringify(state.db.select().from(auditLogs).all())).not.toContain("444455556666");
  });

  it("validates formats and cannot withdraw someone else's request", async () => {
    await expect(submitBankChangeAction(request({ bankIfsc: "HDFC1" }))).resolves.toMatchObject({
      ok: false, code: "VALIDATION", fieldErrors: { bankIfsc: ["Use an 11-character IFSC, e.g. HDFC0001234"] },
    });
    const raviUser = insertUser(state.db);
    const ravi = createEmployee(state.db, hr, employeeInput({ firstName: "Ravi" }), {
      login: { mode: "link", userId: raviUser.id }, onboarding: false,
    });
    const theirs = submitProfileChange(
      state.db, ravi.id, raviUser.id,
      { bankName: null, bankAccount: null, bankIfsc: "HDFC0001234", pan: null, aadhaar: null, passport: null }, null,
    );
    await expect(withdrawBankChangeAction({ requestId: theirs.id })).resolves.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/self-service-actions.test.ts`
Expected: FAIL — `@/app/(app)/me/profile/actions` is missing.

- [ ] **Step 3: Create the actions** — `src/app/(app)/me/profile/actions.ts`

```ts
"use server";

import { z } from "zod";
import type { SessionUser } from "@/lib/auth/types";
import { bankChangeRequestSchema, contactSchema } from "@/lib/validation/employees";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { submitProfileChange, withdrawProfileChange } from "@/server/modules/employees/profile-changes";
import { updateOwnContact } from "@/server/modules/employees/service";

/** Self-service acts only on the caller's own employee record. */
const hasEmployee = (user: SessionUser) => user.employeeId !== null;

export const updateOwnContactAction = defineAction({
  name: "me.update_contact",
  schema: contactSchema,
  permission: hasEmployee,
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = updateOwnContact(tx, user.employeeId!, input);
    audit({
      action: "employee.update_contact", entityType: "employee", entityId: after.id,
      summary: "Updated own contact details", diff: diffObjects(before, after),
    });
    return { id: after.id };
  },
  revalidate: ["/me/profile"],
});

export const submitBankChangeAction = defineAction({
  name: "me.bank_change",
  schema: bankChangeRequestSchema,
  permission: hasEmployee,
  handler: ({ tx, user, audit }, { reason, ...bank }) => {
    const request = submitProfileChange(tx, user.employeeId!, user.id, bank, reason);
    audit({ action: "profile_change.submit", entityType: "employee", entityId: user.employeeId, summary: "Requested a bank details change" });
    return { id: request.id };
  },
  revalidate: ["/me/profile", "/approvals"],
});

export const withdrawBankChangeAction = defineAction({
  name: "me.bank_change_withdraw",
  schema: z.object({ requestId: z.number().int().positive() }),
  permission: hasEmployee,
  handler: ({ tx, user, audit }, { requestId }) => {
    withdrawProfileChange(tx, user.employeeId!, requestId);
    audit({ action: "profile_change.withdraw", entityType: "employee", entityId: user.employeeId, summary: "Withdrew a bank details change request" });
    return { id: requestId };
  },
  revalidate: ["/me/profile", "/approvals"],
});
```

- [ ] **Step 4: The profile forms**

`src/app/(app)/me/profile/contact-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm } from "react-hook-form";
import type { z } from "zod";
import { PersonalFields } from "@/components/employees/personal-fields";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { contactSchema } from "@/lib/validation/employees";
import { updateOwnContactAction } from "./actions";

type FormInput = z.input<typeof contactSchema>;
type FormOutput = z.output<typeof contactSchema>;

export function ContactForm({ initial }: { initial: FormInput }) {
  const router = useRouter();
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(contactSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateOwnContactAction, {
    successMessage: "Contact details saved",
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contact details</CardTitle>
        <CardDescription>You can change these yourself.</CardDescription>
      </CardHeader>
      <FormProvider {...form}>
        <form onSubmit={form.handleSubmit((values) => run(values))}>
          <CardContent>
            <PersonalFields part="contact" />
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Save contact details
            </Button>
          </CardFooter>
        </form>
      </FormProvider>
    </Card>
  );
}
```

`src/app/(app)/me/profile/bank-change-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil } from "lucide-react";
import { FormProvider, useForm } from "react-hook-form";
import type { z } from "zod";
import { BankFields } from "@/components/employees/bank-fields";
import { bankDetailItems, DetailList } from "@/components/employees/detail-list";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/dates";
import { bankChangeRequestSchema } from "@/lib/validation/employees";
import type { BankView } from "@/server/modules/employees/sensitive";
import { submitBankChangeAction, withdrawBankChangeAction } from "./actions";

type FormInput = z.input<typeof bankChangeRequestSchema>;
type FormOutput = z.output<typeof bankChangeRequestSchema>;
const BLANK: FormInput = { bankName: "", bankAccount: "", bankIfsc: "", pan: "", aadhaar: "", passport: "", reason: "" };

export interface PendingChangeView {
  id: number;
  createdAt: string;
  reason: string | null;
  requested: BankView;
}

export function BankChangeCard({ current, pending, timeZone }: { current: BankView; pending: PendingChangeView | null; timeZone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(bankChangeRequestSchema), defaultValues: BLANK });
  const submit = useServerAction(submitBankChangeAction, {
    successMessage: "Change request sent to HR",
    onSuccess: () => {
      setOpen(false);
      form.reset(BLANK);
      router.refresh();
    },
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const withdraw = useServerAction(withdrawBankChangeAction, { successMessage: "Request withdrawn", onSuccess: () => router.refresh() });
  const requested = pending ? bankDetailItems(pending.requested).map((item) => ({ ...item, value: item.value ?? "Unchanged" })) : [];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">Bank &amp; IDs</CardTitle>
          <CardDescription>Changes need HR approval. Numbers are masked.</CardDescription>
        </div>
        {!pending && (
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Pencil /> Request a change
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <DetailList items={bankDetailItems(current)} />
        {pending && (
          <Alert variant="info" title="Change request pending">
            <p>
              Sent {formatDateTime(pending.createdAt, timeZone)}
              {pending.reason ? ` · ${pending.reason}` : ""}
            </p>
            <div className="mt-3">
              <DetailList items={requested} />
            </div>
            <div className="mt-3">
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm">
                    Withdraw request
                  </Button>
                }
                title="Withdraw this request?"
                description="HR won't see it any more. You can send a new one afterwards."
                confirmLabel="Withdraw"
                onConfirm={() => withdraw.run({ requestId: pending.id })}
              />
            </div>
          </Alert>
        )}
      </CardContent>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Request a bank or ID change</SheetTitle>
            <SheetDescription>Fill in only what changes. HR checks it before it takes effect.</SheetDescription>
          </SheetHeader>
          <FormProvider {...form}>
            <form onSubmit={form.handleSubmit((values) => submit.run(values))} className="flex flex-1 flex-col gap-4">
              <BankFields keepHint />
              <Field label="Note for HR" htmlFor="reason" error={form.formState.errors.reason?.message}>
                <Textarea id="reason" rows={3} {...form.register("reason")} />
              </Field>
              <SheetFooter>
                <Button type="submit" disabled={submit.pending}>
                  {submit.pending && <Spinner />}
                  Send request
                </Button>
              </SheetFooter>
            </form>
          </FormProvider>
        </SheetContent>
      </Sheet>
    </Card>
  );
}
```

- [ ] **Step 5: The pages**

`src/app/(app)/me/profile/page.tsx`:

```tsx
import type { Metadata } from "next";
import { UserRound } from "lucide-react";
import { DetailList } from "@/components/employees/detail-list";
import { EMPTY_ADDRESS, EMPTY_EMERGENCY_CONTACT } from "@/components/employees/form-defaults";
import { EmployeeStatusBadge } from "@/components/employees/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { formatDate } from "@/lib/dates";
import { EMPLOYMENT_TYPE_LABELS, GENDER_LABELS, MARITAL_STATUS_LABELS } from "@/lib/hr";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { pendingProfileChangeFor } from "@/server/modules/employees/profile-changes";
import { getEmployeeDetail } from "@/server/modules/employees/queries";
import { bankView } from "@/server/modules/employees/sensitive";
import { getSetting } from "@/server/modules/settings/service";
import { BankChangeCard } from "./bank-change-card";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = { title: "My profile" };

export default async function MyProfilePage() {
  const user = await requireUser();
  const employee = user.employeeId === null ? null : getEmployeeDetail(db, user.employeeId, { revealSensitive: false });
  if (!employee) {
    return (
      <>
        <PageHeader title="My profile" />
        <EmptyState icon={UserRound} title="No employee record yet" description="Your login isn't linked to an employee record. Ask HR to link it." />
      </>
    );
  }
  const pending = pendingProfileChangeFor(db, employee.id);
  const timeZone = getSetting(db, "locale").timezone;

  return (
    <>
      <PageHeader
        title="My profile"
        description={`${employee.displayName} · ${employee.employeeCode}`}
        actions={<EmployeeStatusBadge status={employee.status} />}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Job</CardTitle>
              <CardDescription>Maintained by HR.</CardDescription>
            </CardHeader>
            <CardContent>
              <DetailList
                columns={1}
                items={[
                  { label: "Employee code", value: employee.employeeCode },
                  { label: "Designation", value: employee.designationName },
                  { label: "Department", value: employee.departmentName },
                  { label: "Reporting manager", value: employee.managerName },
                  { label: "Employment type", value: EMPLOYMENT_TYPE_LABELS[employee.employmentType] },
                  { label: "Work email", value: employee.workEmail },
                  { label: "Joined", value: formatDate(employee.dateOfJoining) },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Personal</CardTitle>
              <CardDescription>Ask HR to correct these.</CardDescription>
            </CardHeader>
            <CardContent>
              <DetailList
                columns={1}
                items={[
                  { label: "Date of birth", value: employee.dateOfBirth && formatDate(employee.dateOfBirth) },
                  { label: "Gender", value: employee.gender && GENDER_LABELS[employee.gender] },
                  { label: "Marital status", value: employee.maritalStatus && MARITAL_STATUS_LABELS[employee.maritalStatus] },
                ]}
              />
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6 lg:col-span-2">
          <ContactForm
            initial={{
              personalEmail: employee.personalEmail ?? "",
              phone: employee.phone ?? "",
              address: employee.address ?? EMPTY_ADDRESS,
              emergencyContact: employee.emergencyContact ?? EMPTY_EMERGENCY_CONTACT,
            }}
          />
          <BankChangeCard
            current={employee.bank}
            timeZone={timeZone}
            pending={
              pending
                ? { id: pending.id, createdAt: pending.createdAt, reason: pending.reason, requested: bankView(pending.fields, false) }
                : null
            }
          />
        </div>
      </div>
    </>
  );
}
```

`src/app/(app)/me/documents/page.tsx`:

```tsx
import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { DocumentsCard } from "@/components/employees/documents-card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SELF_DOCUMENT_CATEGORIES } from "@/lib/hr";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { listEmployeeDocuments } from "@/server/modules/employees/documents";
import { getSetting } from "@/server/modules/settings/service";

export const metadata: Metadata = { title: "My documents" };

export default async function MyDocumentsPage() {
  const user = await requireUser();
  if (user.employeeId === null) {
    return (
      <>
        <PageHeader title="My documents" />
        <EmptyState icon={FileText} title="No employee record yet" description="Your login isn't linked to an employee record. Ask HR to link it." />
      </>
    );
  }
  return (
    <>
      <PageHeader title="My documents" description="Offer letters and contracts from HR, plus the ID and education documents you add." />
      <DocumentsCard
        employeeId={user.employeeId}
        documents={listEmployeeDocuments(db, user.employeeId)}
        categories={SELF_DOCUMENT_CATEGORIES}
        canUpload
        canDelete={false}
        timeZone={getSetting(db, "locale").timezone}
      />
    </>
  );
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/integration/self-service-actions.test.ts && npm run typecheck && npm run lint`
Expected: PASS (4 tests), typecheck is clean, lint has 0 errors.

- [ ] **Step 7: Manual check**

On a throwaway dev server, as an employee whose login is linked:
- My Space shows My profile and My documents;
- saving contact details persists after reload;
- "Request a change" with only a new IFSC shows the pending card, with "Unchanged" for every other field, and "Withdraw request" clears it;
- uploading a PAN card PDF on My documents works, and the category list has no Offer letter or Contract;
- the seeded admin (no employee record) sees the empty states instead.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/me" tests/integration/self-service-actions.test.ts
git commit -m "feat(me): add self-service profile, bank change requests and documents"
```

---

### Task 18: Approvals inbox and employee code settings

**Files:**
- Create: `src/app/(app)/approvals/{page,profile-change-list}.tsx`, `src/app/(app)/approvals/actions.ts`
- Create: `src/app/(app)/settings/employee/{page,employee-settings-form}.tsx`, `src/app/(app)/settings/employee/actions.ts`
- Test: `tests/integration/approvals-actions.test.ts`

**Interfaces:**
- Consumes: `decideProfileChange`, `listPendingProfileChanges`, `PendingProfileChange` (Task 11); `nextEmployeeCode` (Task 4); `employeeSettingsSchema`, `patchSetting`, `getSetting` (Phase 0).
- Produces:
  - `decideProfileChangeAction({ requestId, decision, note })`. It needs `employee.update` + `employee.sensitive.view`, because approvers must see the real numbers.
  - `updateEmployeeSettingsAction({ codePrefix, codeDigits })` (`settings.manage`, returns `{ nextCode }`).
  - Page `/approvals` (`employee.update`) with a Profile changes tab; Phase 2 adds the Leave tab. Page `/settings/employee`.

- [ ] **Step 1: Write the failing tests** — `tests/integration/approvals-actions.test.ts`

```ts
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, employees, type EmployeeRow, type ProfileChangeRequestRow, type UserRow } from "@/server/db/schema";
import { submitProfileChange } from "@/server/modules/employees/profile-changes";
import { openBank } from "@/server/modules/employees/sensitive";
import { createEmployee } from "@/server/modules/employees/service";
import { createTestDb } from "../helpers/db";
import { employeeInput } from "../helpers/employees";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { decideProfileChangeAction } from "@/app/(app)/approvals/actions";
import { updateEmployeeSettingsAction } from "@/app/(app)/settings/employee/actions";

const newAccount = { bankName: null, bankAccount: "444455556666", bankIfsc: "HDFC0001234", pan: null, aadhaar: null, passport: null };
let hrUser: UserRow;
let hr: SessionUser;
let asha: EmployeeRow;
let request: ProfileChangeRequestRow;
const employeeRow = (id: number) => state.db.select().from(employees).where(eq(employees.id, id)).get()!;

beforeEach(() => {
  state.db = createTestDb();
  hrUser = insertUser(state.db, { roles: ["hr_admin"] });
  hr = sessionUserFor(state.db, hrUser);
  const ashaUser = insertUser(state.db, { roles: ["employee"] });
  asha = createEmployee(state.db, hr, employeeInput({ bankAccount: "111122223333" }), {
    login: { mode: "link", userId: ashaUser.id }, onboarding: false,
  });
  request = submitProfileChange(state.db, asha.id, ashaUser.id, newAccount, "New account");
  state.user = hr;
});

describe("decideProfileChangeAction", () => {
  it("approves with a masked audit trail", async () => {
    await expect(decideProfileChangeAction({ requestId: request.id, decision: "approved", note: "Verified" })).resolves.toEqual({
      ok: true, data: { status: "approved" },
    });
    expect(openBank(employeeRow(asha.id)).bankAccount).toBe("444455556666");
    const entry = state.db.select().from(auditLogs).where(eq(auditLogs.action, "profile_change.approve")).get()!;
    expect(entry.diff).toMatchObject({ bankAccount: { from: "XXXX3333", to: "XXXX6666" } });
    expect(JSON.stringify(entry)).not.toContain("444455556666");
  });

  it("rejects without touching the bank details", async () => {
    await expect(decideProfileChangeAction({ requestId: request.id, decision: "rejected", note: "" })).resolves.toEqual({
      ok: true, data: { status: "rejected" },
    });
    expect(openBank(employeeRow(asha.id)).bankAccount).toBe("111122223333");
  });

  it("needs employee.update plus sensitive access, and nobody decides their own request", async () => {
    state.user = { ...hr, permissions: hr.permissions.filter((p) => p !== "employee.sensitive.view") };
    await expect(decideProfileChangeAction({ requestId: request.id, decision: "approved", note: null })).resolves.toMatchObject({
      code: "FORBIDDEN",
    });
    const hari = createEmployee(state.db, hr, employeeInput({ firstName: "Hari" }), { login: { mode: "link", userId: hrUser.id }, onboarding: false });
    const own = submitProfileChange(state.db, hari.id, hrUser.id, newAccount, null);
    state.user = sessionUserFor(state.db, hrUser);
    await expect(decideProfileChangeAction({ requestId: own.id, decision: "approved", note: null })).resolves.toMatchObject({
      code: "SELF_APPROVAL",
    });
  });
});

describe("updateEmployeeSettingsAction", () => {
  it("saves the code format and reports the next code", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["super_admin"] }));
    await expect(updateEmployeeSettingsAction({ codePrefix: "EMP", codeDigits: 3 })).resolves.toEqual({ ok: true, data: { nextCode: "EMP001" } });
  });

  it("is limited to settings.manage holders", async () => {
    await expect(updateEmployeeSettingsAction({ codePrefix: "EMP", codeDigits: 3 })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/approvals-actions.test.ts`
Expected: FAIL — both action modules are missing.

- [ ] **Step 3: Approvals** — `src/app/(app)/approvals/actions.ts`

```ts
"use server";

import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { optionalText } from "@/lib/validation/employees";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { decideProfileChange } from "@/server/modules/employees/profile-changes";

export const decideProfileChangeAction = defineAction({
  name: "approvals.profile_change",
  schema: z.object({
    requestId: z.number().int().positive(),
    decision: z.enum(["approved", "rejected"]),
    note: optionalText(300),
  }),
  // Approvers check the real numbers against proof, so they need sensitive access too.
  permission: (user) => can(user, "employee.update") && can(user, "employee.sensitive.view"),
  handler: ({ tx, user, audit }, { requestId, decision, note }) => {
    const { request, before, after } = decideProfileChange(tx, user.id, requestId, decision, note);
    audit({
      action: decision === "approved" ? "profile_change.approve" : "profile_change.reject",
      entityType: "employee",
      entityId: request.employeeId,
      summary: `${decision === "approved" ? "Approved" : "Rejected"} a bank details change request`,
      diff: decision === "approved" ? diffObjects({ ...before }, { ...after }) : null,
    });
    return { status: request.status };
  },
  revalidate: ["/approvals"],
});
```

`src/app/(app)/approvals/profile-change-list.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/dates";
import type { PendingProfileChange } from "@/server/modules/employees/profile-changes";
import { decideProfileChangeAction } from "./actions";

const FIELDS = [
  ["Bank name", "bankName"],
  ["Account number", "bankAccount"],
  ["IFSC", "bankIfsc"],
  ["PAN", "pan"],
  ["Aadhaar", "aadhaar"],
  ["Passport", "passport"],
] as const;

type Decision = { change: PendingProfileChange; decision: "approved" | "rejected" };

export function ProfileChangeList({
  changes,
  ownEmployeeId,
  timeZone,
}: {
  changes: PendingProfileChange[];
  ownEmployeeId: number | null;
  timeZone: string;
}) {
  const router = useRouter();
  const [deciding, setDeciding] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const { run, pending } = useServerAction(decideProfileChangeAction, {
    successMessage: (d) => (d.status === "approved" ? "Change approved" : "Change rejected"),
    onSuccess: () => {
      setDeciding(null);
      setNote("");
      router.refresh();
    },
  });

  if (changes.length === 0) {
    return <EmptyState title="No pending requests" description="Bank and ID change requests from employees appear here." />;
  }

  return (
    <div className="space-y-4">
      {changes.map((change) => {
        const own = change.employeeId === ownEmployeeId;
        return (
          <Card key={change.id}>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div className="space-y-1">
                <CardTitle className="text-base">
                  <Link href={`/org/employees/${change.employeeId}?tab=bank`} className="hover:underline">
                    {change.employeeName}
                  </Link>{" "}
                  <span className="text-sm font-normal text-muted-foreground">{change.employeeCode}</span>
                </CardTitle>
                <CardDescription>
                  Bank details change · requested {formatDateTime(change.createdAt, timeZone)}
                  {change.reason ? ` · “${change.reason}”` : ""}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={own} onClick={() => setDeciding({ change, decision: "rejected" })}>
                  Reject
                </Button>
                <Button size="sm" disabled={own} onClick={() => setDeciding({ change, decision: "approved" })}>
                  Approve
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {own && <p className="mb-3 text-sm text-muted-foreground">This is your own request, so someone else has to decide it.</p>}
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Field</TableHead>
                    <TableHead>Current</TableHead>
                    <TableHead>Requested</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {FIELDS.map(([label, key]) => (
                    <TableRow key={key}>
                      <TableCell className="text-muted-foreground">{label}</TableCell>
                      <TableCell>{change.current[key] ?? "—"}</TableCell>
                      <TableCell className={change.requested[key] ? "font-medium" : "text-muted-foreground"}>
                        {change.requested[key] ?? "Unchanged"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
      <Dialog open={deciding !== null} onOpenChange={(open) => !open && setDeciding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deciding?.decision === "approved" ? "Approve this change?" : "Reject this change?"}</DialogTitle>
            <DialogDescription>
              {deciding?.decision === "approved"
                ? `The requested values replace ${deciding.change.employeeName}'s bank details.`
                : "The current bank details stay as they are."}
            </DialogDescription>
          </DialogHeader>
          <Field label="Note (optional)" htmlFor="decision-note">
            <Textarea id="decision-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>
              Cancel
            </Button>
            <Button
              variant={deciding?.decision === "rejected" ? "destructive" : "default"}
              disabled={pending}
              onClick={() => deciding && run({ requestId: deciding.change.id, decision: deciding.decision, note })}
            >
              {pending && <Spinner />}
              {deciding?.decision === "approved" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

`src/app/(app)/approvals/page.tsx`:

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { listPendingProfileChanges } from "@/server/modules/employees/profile-changes";
import { getSetting } from "@/server/modules/settings/service";
import { ProfileChangeList } from "./profile-change-list";

export const metadata: Metadata = { title: "Approvals" };

/** Phase 1 has one tab; Phase 2 adds Leave, Phase 3 Comp-off and Regularization, and so on (spec §5.7). */
export default async function ApprovalsPage() {
  const user = await requirePermission("employee.update");
  const changes = listPendingProfileChanges(db, can(user, "employee.sensitive.view"));
  return (
    <>
      <PageHeader title="Approvals" description="Requests waiting for a decision." />
      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile changes{changes.length ? ` (${changes.length})` : ""}</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileChangeList changes={changes} ownEmployeeId={user.employeeId} timeZone={getSetting(db, "locale").timezone} />
        </TabsContent>
      </Tabs>
    </>
  );
}
```

- [ ] **Step 4: Employee code settings** — `src/app/(app)/settings/employee/actions.ts`

```ts
"use server";

import { employeeSettingsSchema } from "@/lib/validation/settings";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { nextEmployeeCode } from "@/server/modules/employees/code";
import { patchSetting } from "@/server/modules/settings/service";

export const updateEmployeeSettingsAction = defineAction({
  name: "settings.employee.update",
  schema: employeeSettingsSchema,
  permission: "settings.manage",
  handler: ({ tx, user, audit }, input) => {
    const { before, after } = patchSetting(tx, "employee", input, user.id);
    audit({
      action: "settings.update", entityType: "settings", entityId: "employee",
      summary: "Updated employee code settings", diff: diffObjects(before, after),
    });
    return { nextCode: nextEmployeeCode(tx) };
  },
  revalidate: ["/settings/employee"],
});
```

`src/app/(app)/settings/employee/employee-settings-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { applyFieldErrors, useServerAction } from "@/components/forms/use-server-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { employeeSettingsSchema } from "@/lib/validation/settings";
import { updateEmployeeSettingsAction } from "./actions";

type Values = z.infer<typeof employeeSettingsSchema>;

export function EmployeeSettingsForm({ initial, nextCode }: { initial: Values; nextCode: string }) {
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(employeeSettingsSchema), defaultValues: initial });
  const { run, pending } = useServerAction(updateEmployeeSettingsAction, {
    successMessage: (d) => `Saved. The next employee gets ${d.nextCode}.`,
    onSuccess: () => router.refresh(),
    onError: (r) => applyFieldErrors(form.setError, r.fieldErrors),
  });
  const prefix = form.watch("codePrefix");
  const digits = form.watch("codeDigits");
  const example = `${prefix || "PV"}${"1".padStart(Number.isInteger(digits) ? digits : 4, "0")}`;
  const errors = form.formState.errors;

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Employee codes</CardTitle>
        <CardDescription>New employees get the next number after the highest existing code with this prefix.</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => run(values))}>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Prefix" htmlFor="codePrefix" error={errors.codePrefix?.message} hint="1–5 capital letters">
            <Input id="codePrefix" {...form.register("codePrefix", { setValueAs: (v: string) => v.toUpperCase() })} />
          </Field>
          <Field label="Digits" htmlFor="codeDigits" error={errors.codeDigits?.message} hint="3–6">
            <Input id="codeDigits" type="number" min={3} max={6} {...form.register("codeDigits", { valueAsNumber: true })} />
          </Field>
          <p className="text-sm text-muted-foreground sm:col-span-2">
            Format: <span className="font-mono">{example}</span> · next code with the saved settings:{" "}
            <span className="font-mono">{nextCode}</span>
          </p>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            Save
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
```

`src/app/(app)/settings/employee/page.tsx`:

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { nextEmployeeCode } from "@/server/modules/employees/code";
import { getSetting } from "@/server/modules/settings/service";
import { EmployeeSettingsForm } from "./employee-settings-form";

export const metadata: Metadata = { title: "Employee codes" };

export default async function EmployeeSettingsPage() {
  await requirePermission("settings.manage");
  return (
    <>
      <PageHeader title="Employee codes" description="How new employee codes are generated." />
      <EmployeeSettingsForm initial={getSetting(db, "employee")} nextCode={nextEmployeeCode(db)} />
    </>
  );
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/integration/approvals-actions.test.ts && npm run typecheck && npm run lint`
Expected: PASS (5 tests), typecheck is clean, lint has 0 errors.

- [ ] **Step 6: Manual check**

On a throwaway dev server:
- an employee submits a bank change; HR sees it on `/approvals` with the real numbers next to the current ones, and approves it with a note;
- the audit log entry shows only masked values;
- an HR admin who submitted their own request sees disabled buttons on it;
- change the prefix to `EMP` on `/settings/employee`: the toast reports `EMP0001`, and the wizard's code hint changes.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/approvals" "src/app/(app)/settings/employee" tests/integration/approvals-actions.test.ts
git commit -m "feat(approvals): add profile change approvals and employee code settings"
```

---

### Task 19: CSV import page

**Files:**
- Create: `src/app/(app)/org/import/{page,import-client}.tsx`, `src/app/(app)/org/import/actions.ts`
- Test: `tests/integration/import-actions.test.ts`

**Interfaces:**
- Consumes: `previewEmployeeImport`, `commitEmployeeImport`, `ImportPreview` (Task 12); `IMPORT_COLUMNS`, `IMPORT_TEMPLATE_CSV` (Task 12).
- Produces:
  - `previewImportAction({ csv })`, which returns an `ImportPreview` and writes nothing, so it has no audit entry.
  - `commitImportAction({ csv })`, which returns `{ created, codes }` and is audited as `employee.import`.
  - Both need `employee.import`; the CSV is limited to 1 MB.
  - Page `/org/import`.

- [ ] **Step 1: Write the failing tests** — `tests/integration/import-actions.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, employees } from "@/server/db/schema";
import { createTestDb } from "../helpers/db";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { commitImportAction, previewImportAction } from "@/app/(app)/org/import/actions";

const csv = "first_name,last_name,work_email,date_of_joining\nAsha,Rao,asha@pvcon.in,2026-10-01\nRavi,Menon,ravi@pvcon.in,2026-10-05\n";

beforeEach(() => {
  state.db = createTestDb();
  state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
});

describe("import actions", () => {
  it("previews for employee.import holders without saving anything", async () => {
    await expect(previewImportAction({ csv })).resolves.toMatchObject({ ok: true, data: { valid: 2, invalid: 0, fileErrors: [] } });
    expect(state.db.select().from(employees).all()).toEqual([]);
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["employee"] }));
    await expect(previewImportAction({ csv })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("commits every row in one go and audits it", async () => {
    await expect(commitImportAction({ csv })).resolves.toEqual({ ok: true, data: { created: 2, codes: ["PV0001", "PV0002"] } });
    expect(state.db.select().from(auditLogs).all().map((a) => a.action)).toEqual(["employee.import"]);
  });

  it("imports nothing when a row is invalid", async () => {
    await expect(commitImportAction({ csv: `${csv}Kiran,Das,asha@pvcon.in,2026-10-05\n` })).resolves.toMatchObject({
      ok: false, code: "IMPORT_INVALID",
    });
    expect(state.db.select().from(employees).all()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/integration/import-actions.test.ts`
Expected: FAIL — `@/app/(app)/org/import/actions` is missing.

- [ ] **Step 3: Create the actions** — `src/app/(app)/org/import/actions.ts`

```ts
"use server";

import { z } from "zod";
import { defineAction } from "@/server/actions/define";
import { commitEmployeeImport, previewEmployeeImport } from "@/server/modules/employees/import";

const csvSchema = z.object({
  csv: z.string().min(1, "Choose a CSV file").max(1_000_000, "Files over 1 MB are too large"),
});

/** Read-only dry run (spec §5.1): nothing is written, so there is nothing to audit. */
export const previewImportAction = defineAction({
  name: "employees.import_preview",
  schema: csvSchema,
  permission: "employee.import",
  handler: ({ tx }, { csv }) => previewEmployeeImport(tx, csv),
});

export const commitImportAction = defineAction({
  name: "employees.import",
  schema: csvSchema,
  permission: "employee.import",
  handler: ({ tx, user, audit }, { csv }) => {
    const result = commitEmployeeImport(tx, user, csv);
    audit({ action: "employee.import", entityType: "employee", summary: `Imported ${result.created} employee(s): ${result.codes.join(", ")}` });
    return result;
  },
  revalidate: ["/org/employees"],
});
```

- [ ] **Step 4: The page** — `src/app/(app)/org/import/import-client.tsx`

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { Download, FileUp, Upload } from "lucide-react";
import { toast } from "sonner";
import { useServerAction } from "@/components/forms/use-server-action";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IMPORT_COLUMNS, IMPORT_TEMPLATE_CSV } from "@/lib/validation/employee-import";
import type { ImportPreview } from "@/server/modules/employees/import";
import { commitImportAction, previewImportAction } from "./actions";

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([IMPORT_TEMPLATE_CSV], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "pvcon-employee-import-template.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportClient() {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<{ created: number; codes: string[] } | null>(null);
  const check = useServerAction(previewImportAction, { onSuccess: (result) => setPreview(result) });
  const commit = useServerAction(commitImportAction, {
    onSuccess: (result) => {
      setDone(result);
      setPreview(null);
      setCsv(null);
      toast.success(`Imported ${result.created} employee(s)`);
    },
  });
  const ready = preview !== null && preview.fileErrors.length === 0 && preview.invalid === 0 && preview.valid > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Prepare the file</CardTitle>
          <CardDescription>
            Only first_name and date_of_joining are required. Departments and designations must already exist; managers are matched by
            work email (a new manager must be on an earlier row).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={downloadTemplate}>
            <Download /> Download template
          </Button>
          <p className="text-xs text-muted-foreground">
            Columns: <span className="font-mono">{IMPORT_COLUMNS.join(", ")}</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Check it</CardTitle>
          <CardDescription>Nothing is saved until you import. Imported employees get no login and no onboarding checklist.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field label="CSV file" htmlFor="import-file">
            <Input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                setPreview(null);
                setDone(null);
                setFileName(file?.name ?? "");
                setCsv(file ? await file.text() : null);
              }}
            />
          </Field>
          <Button disabled={!csv || check.pending} onClick={() => csv && check.run({ csv })}>
            {check.pending ? <Spinner /> : <FileUp />} Check file
          </Button>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-base">3. Import</CardTitle>
              <CardDescription>
                {fileName}: {preview.valid} ready, {preview.invalid} with errors.
              </CardDescription>
            </div>
            <Button disabled={!ready || commit.pending} onClick={() => csv && commit.run({ csv })}>
              {commit.pending ? <Spinner /> : <Upload />} Import {preview.valid} employee(s)
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {preview.fileErrors.map((error) => (
              <Alert key={error} variant="destructive" title={error} />
            ))}
            {preview.rows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Row</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Work email</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Check</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={row.row}>
                      <TableCell>{row.row}</TableCell>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row.workEmail ?? "—"}</TableCell>
                      <TableCell>{row.employeeCode ?? "auto"}</TableCell>
                      <TableCell>
                        {row.errors.length === 0 ? (
                          <Badge variant="success">Ready</Badge>
                        ) : (
                          <ul className="space-y-0.5 text-xs text-destructive">
                            {row.errors.map((error) => (
                              <li key={error}>{error}</li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {done && (
        <Alert variant="success" title={`Imported ${done.created} employee(s)`}>
          {done.codes.join(", ")} ·{" "}
          <Link href="/org/employees" className="text-primary hover:underline">
            View employees
          </Link>
        </Alert>
      )}
    </div>
  );
}
```

`src/app/(app)/org/import/page.tsx`:

```tsx
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/server/auth/session";
import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import employees" };

export default async function ImportPage() {
  await requirePermission("employee.import");
  return (
    <>
      <PageHeader title="Import employees" description="Add many employee records at once from a CSV file." />
      <ImportClient />
    </>
  );
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/integration/import-actions.test.ts && npm run typecheck && npm run lint`
Expected: PASS (3 tests), typecheck is clean, lint has 0 errors.

- [ ] **Step 6: Manual check**

On a throwaway dev server, as HR:
- the downloaded template opens with the 16 columns and 2 example rows;
- after creating the "Engineering" department and "Consultant" designation, the template imports as-is ("PV0101" and an auto code);
- a file with an unknown department shows the row error, and the Import button stays disabled.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/org/import" tests/integration/import-actions.test.ts
git commit -m "feat(org): add CSV import page"
```

---

### Task 20: E2E, verification, documentation

**Files:**
- Create: `tests/e2e/helpers.ts`, `tests/e2e/core-hr.spec.ts`
- Modify: `tests/e2e/auth.spec.ts` (use the shared helpers), `docs/superpowers/plans/2026-09-24-hrms-roadmap.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: the Phase 1 pages and the Phase 0 auth pages.
- Produces: `signIn`, `changePassword` and `signInAsAdmin` in `tests/e2e/helpers.ts`. `signInAsAdmin` works whether or not an earlier spec already replaced the seed password.

- [ ] **Step 1: Create `tests/e2e/helpers.ts`**

```ts
import { expect, type Page } from "@playwright/test";

export const ADMIN_EMAIL = "admin@pvcon.in";
export const SEED_PASSWORD = "ChangeMe@2026";
export const ADMIN_PASSWORD = "Adm1n-Strong-Pass";

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function changePassword(page: Page, current: string, next: string) {
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel("Current password").fill(current);
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Confirm new password").fill(next);
  await page.getByRole("button", { name: "Update password" }).click();
}

/** Signs in as the seeded admin, replacing the seed password first when no earlier spec has done so. */
export async function signInAsAdmin(page: Page) {
  await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  const home = page.waitForURL((url) => url.pathname === "/").then(() => "home" as const, () => "timeout" as const);
  const wrong = page
    .getByText("Incorrect email or password.")
    .waitFor()
    .then(() => "wrong" as const, () => "timeout" as const);
  if ((await Promise.race([home, wrong])) === "wrong") {
    await signIn(page, ADMIN_EMAIL, SEED_PASSWORD);
    await changePassword(page, SEED_PASSWORD, ADMIN_PASSWORD);
  }
  await expect(page).toHaveURL(/\/$/);
}
```

In `tests/e2e/auth.spec.ts`, delete the local `ADMIN_EMAIL`, `SEED_PASSWORD`, `ADMIN_PASSWORD` constants and the local `signIn` and `changePassword` functions. Import them instead (keep `EMPLOYEE_EMAIL` and `EMPLOYEE_PASSWORD`). `type Page` is then unused, so the first import line becomes `import { expect, test } from "@playwright/test";`:

```ts
import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, SEED_PASSWORD, changePassword, signIn } from "./helpers";
```

- [ ] **Step 2: Write `tests/e2e/core-hr.spec.ts`**

```ts
import { expect, test } from "@playwright/test";
import { changePassword, signIn, signInAsAdmin } from "./helpers";

const EMPLOYEE_EMAIL = "asha.rao@pvcon.in";
const EMPLOYEE_PASSWORD = "Asha-Strong-Pass1";

test.describe.serial("core HR", () => {
  let tempPassword = "";

  test("HR sets up a department and a designation", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/org/departments");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "New department" }).click();
    await page.getByLabel("Name").fill("Engineering");
    await page.getByLabel("Code").fill("eng");
    await page.getByRole("button", { name: "Create department" }).click();
    await expect(page.getByRole("row", { name: /Engineering/ })).toBeVisible();

    await page.goto("/org/designations");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "New designation" }).click();
    await page.getByLabel("Name").fill("Consultant");
    await page.getByRole("button", { name: "Create designation" }).click();
    await expect(page.getByRole("row", { name: /Consultant/ })).toBeVisible();
  });

  test("HR adds an employee with a login through the wizard", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/org/employees/new");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("First name").fill("Asha");
    await page.getByLabel("Last name").fill("Rao");
    await page.getByLabel("Work email").fill(EMPLOYEE_EMAIL);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Department", { exact: true }).selectOption({ label: "Engineering" });
    await page.getByLabel("Designation", { exact: true }).selectOption({ label: "Consultant" });
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Account number").fill("111122223333");
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByLabel("Login", { exact: true }).selectOption("create");
    await page.getByRole("button", { name: "Create employee" }).click();

    const dialog = page.getByRole("dialog", { name: "Temporary password" });
    await expect(dialog).toBeVisible();
    tempPassword = (await dialog.getByTestId("temp-password").textContent())?.trim() ?? "";
    expect(tempPassword).toHaveLength(14);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(page).toHaveURL(/\/org\/employees\/\d+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Asha Rao");
  });

  test("the employee signs in, sees their profile and updates their phone", async ({ page }) => {
    await signIn(page, EMPLOYEE_EMAIL, tempPassword);
    await changePassword(page, tempPassword, EMPLOYEE_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/me/profile");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/PV0001/).first()).toBeVisible();
    await page.getByLabel("Phone", { exact: true }).fill("+91 98450 12345");
    await page.getByRole("button", { name: "Save contact details" }).click();
    await expect(page.getByText("Contact details saved")).toBeVisible();
  });

  test("the employee asks HR to change their bank account", async ({ page }) => {
    await signIn(page, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/me/profile");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Request a change" }).click();
    await page.getByLabel("Account number").fill("444455556666");
    await page.getByLabel("IFSC").fill("HDFC0001234");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Change request pending")).toBeVisible();
  });

  test("HR approves the change", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/approvals");
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("444455556666")).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("No pending requests")).toBeVisible();
  });

  test("the employee sees the new, masked account", async ({ page }) => {
    await signIn(page, EMPLOYEE_EMAIL, EMPLOYEE_PASSWORD);
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/me/profile");
    await expect(page.getByText("XXXX6666")).toBeVisible();
  });
});
```

The login limiter allows 20 sign-ins per 15 minutes per address, and both specs together use about 16. If a later phase's specs go past that, reuse sessions through Playwright `storageState` rather than signing in per test.

- [ ] **Step 3: Run the e2e suite**

Stop any running dev server first (it shares `.next`). Run: `npm run test:e2e`
Expected: 12 passed (6 auth + 6 core HR). If a test fails, open the trace (`npx playwright show-trace test-results/**/trace.zip`), fix the app, and re-run. Change a test only where it contradicts this plan, and ledger the ruling.

- [ ] **Step 4: Full verification**

Run: `npm run verify`
Expected: typecheck, lint (0 errors), every vitest suite, and `next build` pass. The route list includes `/org/*`, `/me/*`, `/approvals` and `/settings/employee`.

- [ ] **Step 5: Update the roadmap and the project guide**

In `docs/superpowers/plans/2026-09-24-hrms-roadmap.md`:
- set row "1 Core HR" to `☑ done (<hash of the last Phase 1 code commit>)` and its plan column to `2026-09-25-phase-1-core-hr.md`;
- append these entries to "Spec refinements":

```markdown
13. **Profile change requests cover bank and ID numbers only.** Spec §5.1 lets employees edit their contact fields
    (phone, personal email, address, emergency contact) directly, so the Phase 1 E2E uses a bank change instead of the
    roadmap's phone-change example. A request carries only the values the employee typed; blank keeps the current value.
    Nobody decides their own request (`SELF_APPROVAL`), and approvers need `employee.sensitive.view`.
14. **Core HR schema additions** beyond spec §4.2: `checklist_templates.is_default`/`archived`, `employee_checklists.name`
    and status `open|completed|cancelled`, `profile_change_requests.reason`/`requested_by`. `employees.shift_id` arrives
    with `shifts` in Phase 3.
15. **Team approval permissions.** Anyone with at least one current direct report receives `TEAM_APPROVAL_PERMISSIONS`
    (leave, comp-off, regularization, timesheet and claim approval) for their reporting tree. Later approval flows must
    check `isInScope(db, user, employeeId)`, which is never true for the user's own record.
16. **Approvals inbox starts in Phase 1** with the Profile changes tab (nav item visible to `employee.update`).
    Phase 2 adds the Leave tab and widens the nav item's `anyOf` to the approval permissions.
17. **CSV import** creates employee records only: no logins, no onboarding checklists. Managers are matched by
    `manager_email`; a new manager must be on an earlier row. Commit is all-or-nothing.
18. **Photo upload** (`employees.photo_file_id`) is deferred to the Phase 6 polish pass; the directory shows initials.
19. **Profile visibility.** Managers see Overview, Job, Documents, History and Checklists for their reporting tree;
    Personal and Bank & IDs are limited to the employee and org-wide viewers (`employee.view`). Out-of-scope profile
    URLs return 404.
20. **Exit flow.** HR can withdraw a resignation (on notice → active, open offboarding checklist cancelled). The
    `employee:lifecycle` job never disables the last active super admin's login.
21. **Probation reminders** go to `employee.update` holders once per employee and probation end date, when it is
    within the next 7 days.
```

- update the cross-phase integration map row for Phase 1 employees to name the real seams: `getReportingTree(db, managerEmployeeId)`, `isInScope`, `canViewEmployee`, `SessionUser.employeeId`/`hasReports`, `recordEmployeeEvent()`, `activeUserIdsWithPermission()`.

In `CLAUDE.md`, under "Architecture rules → Authorization", add:

```markdown
  - Manager scope comes from reporting lines. `SessionUser.employeeId`/`hasReports` are loaded from the DB each request.
    Use `isInScope(db, user, employeeId)` for approvals and team actions (self is never in scope) and `canViewEmployee`
    for read access (`src/server/modules/employees/scope.ts`).
```

Add a new bullet under "Architecture rules" after "Money":

```markdown
- **Sensitive employee data**
  - Bank account and ID numbers are stored with `sealBank()` and shown with `bankView(source, reveal)`
    (`src/server/modules/employees/sensitive.ts`). `reveal` only for `employee.sensitive.view`.
  - Never send `*Enc` columns to client components, and audit only masked views.
```

- [ ] **Step 6: Commit and push**

```bash
git add tests/e2e docs/superpowers/plans/2026-09-24-hrms-roadmap.md CLAUDE.md
git commit -m "test(e2e): cover onboarding, self-service and bank change approval"
git push origin feat/hrms-overhaul
```

---

## Self-review notes (planner)

- **Spec coverage:**
  - §4.2 tables: Task 2 (all eight; `shift_id` deferred to Phase 3 as the roadmap plans).
  - §5.1:
    - wizard basic → job → personal → bank → login: Task 14;
    - auto employee code with configurable prefix: Tasks 4 and 18;
    - profile tabs: Task 15;
    - events on job changes: Task 7;
    - directory and org chart: Task 16;
    - CSV import with dry run: Tasks 12 and 19;
    - exit flow with nightly job: Task 9;
    - onboarding checklist from the default template: Tasks 6 and 7;
    - self-service contact edits plus approved bank/ID changes: Tasks 11, 17 and 18.
  - F&F prompts (spec §5.1) belong to Phase 5 payroll.
  - §3.2 manager scope, including implicit scope for anyone with reports: Task 5.
  - §5.7 profile-change tab: Task 18.
  - §6 routes `/org/*`, `/me/profile`, `/me/documents`: Tasks 13–19.
  - §3.4 sensitive masking: Tasks 4, 8, 11 and 15.
  - Uploads through `saveUpload` plus a resolver: Task 10.
- **Roadmap items 1–15** map to Tasks 2, 1, 4, 4, 3, 7, 5, 9, 6, 10, 11, 12, 13–19, 14/15 (the super admin can link to an employee record through the wizard's "Link an existing login" or the profile's Login card), and 20.
- **Names later phases reuse:**
  - scope: `getReportingTree`, `getDirectReportIds`, `isInScope`, `canViewEmployee`, `viewableEmployeeIds`;
  - employees: `requireEmployee`, `recordEmployeeEvent`, `createEmployee`, `getEmployeeByUserId`, `employeeOptions`;
  - users and permissions: `activeUserIdsWithPermission`, `deactivateUserForExit`, `permissionsForUser`, `TEAM_APPROVAL_PERMISSIONS`;
  - UI: `EmployeeStatusBadge`, `DetailList`, `DocumentsCard`, `ChecklistCard`, `idOrNull`/`textOrNull`, the `NAV` groups (Home/My Space/Organization/Settings).
- **Known limits,** also listed as refinements:
  - imports create no logins;
  - photo upload is deferred;
  - out-of-scope profiles return 404 rather than 403, so ids leak nothing.
