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
