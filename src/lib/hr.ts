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
