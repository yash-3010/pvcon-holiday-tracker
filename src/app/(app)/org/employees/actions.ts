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
