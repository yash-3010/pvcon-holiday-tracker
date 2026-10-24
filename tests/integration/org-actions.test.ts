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
