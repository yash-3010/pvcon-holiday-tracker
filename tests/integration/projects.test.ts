import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProjectInput } from "@/lib/validation/timesheets";
import type { DB } from "@/server/db/client";
import { projectMembers, projects, taskCategories } from "@/server/db/schema";
import { listCategories, listClients, listProjects, projectMembersOf } from "@/server/modules/projects/queries";
import {
  addMembers, createCategory, createClient, createProject, seedTimesheetDefaults, setCategoryArchived, setClientArchived, setMemberActive,
  updateClient, updateProject,
} from "@/server/modules/projects/service";
import { createTestDb } from "../helpers/db";
import { insertEmployee } from "../helpers/employees";
import { expectDomainError } from "../helpers/fixtures";

let db: DB;
beforeEach(() => {
  db = createTestDb();
});

const project = (overrides: Partial<ProjectInput> = {}): ProjectInput => ({
  name: "Website", code: "WEB", clientId: null, billableDefault: true, status: "active", startDate: null, endDate: null,
  budgetHours: null, managerEmployeeId: null, ...overrides,
});

describe("clients", () => {
  it("keeps names and codes unique, ignoring case", () => {
    const acme = createClient(db, { name: "Acme", code: "ACME" });
    expectDomainError(() => createClient(db, { name: "acme", code: null }), "DUPLICATE_NAME");
    expectDomainError(() => createClient(db, { name: "Other", code: "ACME" }), "DUPLICATE_CODE");
    expect(updateClient(db, acme.id, { name: "Acme Corp", code: "ACME" }).after.name).toBe("Acme Corp");
    expect(listClients(db).map((c) => [c.name, c.projects])).toEqual([["Acme Corp", 0]]);
  });

  it("archives a client only once its projects are closed", () => {
    const acme = createClient(db, { name: "Acme", code: null });
    const web = createProject(db, project({ clientId: acme.id }));
    expectDomainError(() => setClientArchived(db, acme.id, true), "CLIENT_IN_USE");
    updateProject(db, web.id, project({ clientId: acme.id, status: "closed" }));
    expect(setClientArchived(db, acme.id, true).archived).toBe(true);
    expectDomainError(() => createProject(db, project({ code: "NEW", clientId: acme.id })), "ARCHIVED");
  });
});

describe("projects and members", () => {
  it("keeps codes unique and refuses a manager who has left", () => {
    createProject(db, project());
    expectDomainError(() => createProject(db, project({ name: "Other" })), "DUPLICATE_CODE");
    const gone = insertEmployee(db, { status: "exited" });
    expectDomainError(() => createProject(db, project({ code: "X1", managerEmployeeId: gone.id })), "NOT_CURRENT");
  });

  it("adds current employees as members, deactivates and reactivates them", () => {
    const web = createProject(db, project());
    const asha = insertEmployee(db, { firstName: "Asha" });
    const ravi = insertEmployee(db, { firstName: "Ravi" });
    const gone = insertEmployee(db, { status: "exited" });
    expect(addMembers(db, web.id, [asha.id, ravi.id], "Developer")).toBe(2);
    expectDomainError(() => addMembers(db, web.id, [gone.id], null), "NOT_CURRENT");
    setMemberActive(db, web.id, asha.id, false);
    expect(projectMembersOf(db, web.id).map((m) => [m.name, m.active])).toEqual([["Asha Test", false], ["Ravi Test", true]]);
    expect(addMembers(db, web.id, [asha.id], "Lead")).toBe(1);
    expect(db.select().from(projectMembers).where(eq(projectMembers.employeeId, asha.id)).get()).toMatchObject({ active: true, role: "Lead" });
    expect(listProjects(db, {}).map((p) => [p.code, p.clientName, p.members])).toEqual([["WEB", null, 2]]);
  });
});

describe("categories and defaults", () => {
  it("keeps category names unique and archives them", () => {
    const dev = createCategory(db, { name: "Development", billableDefault: true });
    expectDomainError(() => createCategory(db, { name: "development", billableDefault: false }), "DUPLICATE_NAME");
    setCategoryArchived(db, dev.id, true);
    expect(listCategories(db, {})).toEqual([]);
    expect(listCategories(db, { includeArchived: true })).toHaveLength(1);
  });

  it("seeds categories and an internal project once", () => {
    seedTimesheetDefaults(db);
    seedTimesheetDefaults(db);
    expect(db.select({ name: taskCategories.name, billable: taskCategories.billableDefault }).from(taskCategories).all()).toEqual([
      { name: "Development", billable: true },
      { name: "Design", billable: true },
      { name: "Testing", billable: true },
      { name: "Meetings", billable: true },
      { name: "Documentation", billable: true },
      { name: "Support", billable: true },
      { name: "Training", billable: false },
      { name: "Internal admin", billable: false },
    ]);
    expect(db.select().from(projects).all()).toMatchObject([{ code: "INT", name: "Internal", clientId: null, billableDefault: false, status: "active" }]);
  });
});
