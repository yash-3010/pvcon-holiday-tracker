import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, clients, projectMembers, projects, taskCategories } from "@/server/db/schema";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
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

import { archiveCategoryAction, createCategoryAction, updateCategoryAction } from "@/app/(app)/time/categories/actions";
import { archiveClientAction, createClientAction, updateClientAction } from "@/app/(app)/time/clients/actions";
import { addMembersAction, createProjectAction, setMemberActiveAction, updateProjectAction } from "@/app/(app)/time/projects/actions";

const audits = () => state.db.select().from(auditLogs).all().map((a) => a.action);

beforeEach(() => {
  state.db = createTestDb();
  state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
});

describe("client actions", () => {
  it("creates, renames and archives a client with audit entries", async () => {
    const created = await createClientAction({ name: "Acme", code: "acme" });
    expect(created).toMatchObject({ ok: true });
    const id = (created as { data: { id: number } }).data.id;
    await expect(createClientAction({ name: "ACME", code: null })).resolves.toMatchObject({ ok: false, code: "DUPLICATE_NAME", fieldErrors: { name: ["Already exists"] } });
    await expect(updateClientAction({ id, name: "Acme Corp", code: "ACME" })).resolves.toEqual({ ok: true, data: { id } });
    await expect(archiveClientAction({ id, archived: true })).resolves.toEqual({ ok: true, data: { archived: true } });
    expect(state.db.select().from(clients).where(eq(clients.id, id)).get()).toMatchObject({ name: "Acme Corp", archived: true });
    expect(audits()).toEqual(["client.create", "client.update", "client.archive"]);
  });

  it("needs project.manage", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["manager"] }));
    await expect(createClientAction({ name: "Acme", code: null })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("category actions", () => {
  it("creates, edits and archives a category with audit entries", async () => {
    const created = await createCategoryAction({ name: "Research", billableDefault: false });
    const id = (created as { data: { id: number } }).data.id;
    await expect(updateCategoryAction({ id, name: "R&D", billableDefault: true })).resolves.toEqual({ ok: true, data: { id } });
    await expect(archiveCategoryAction({ id, archived: true })).resolves.toEqual({ ok: true, data: { archived: true } });
    expect(state.db.select().from(taskCategories).get()).toMatchObject({ name: "R&D", billableDefault: true, archived: true });
    expect(audits()).toEqual(["category.create", "category.update", "category.archive"]);
  });
});

describe("project actions", () => {
  const input = {
    name: "Website", code: "web", clientId: null, billableDefault: true, status: "active" as const, startDate: null, endDate: null,
    budgetHours: 200, managerEmployeeId: null,
  };

  it("creates and updates a project, and manages its members, with audit entries", async () => {
    const created = await createProjectAction(input);
    const id = (created as { data: { id: number } }).data.id;
    await expect(createProjectAction({ ...input, name: "Other" })).resolves.toMatchObject({ code: "DUPLICATE_CODE", fieldErrors: { code: ["Already used"] } });
    await expect(updateProjectAction({ ...input, id, status: "on_hold" })).resolves.toEqual({ ok: true, data: { id } });
    expect(state.db.select().from(projects).get()).toMatchObject({ code: "WEB", status: "on_hold", budgetHours: 200 });
    const asha = insertEmployee(state.db);
    await expect(addMembersAction({ projectId: id, employeeIds: [asha.id], role: "Developer" })).resolves.toEqual({ ok: true, data: { added: 1 } });
    await expect(setMemberActiveAction({ projectId: id, employeeId: asha.id, active: false })).resolves.toEqual({ ok: true, data: { active: false } });
    expect(state.db.select().from(projectMembers).get()).toMatchObject({ role: "Developer", active: false });
    expect(audits()).toEqual(["project.create", "project.update", "project.members", "project.members"]);
  });

  it("needs project.manage", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["payroll_admin"] }));
    await expect(createProjectAction(input)).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
