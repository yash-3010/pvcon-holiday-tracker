import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import type { CategoryInput, ClientInput, ProjectInput } from "@/lib/validation/timesheets";
import type { DbLike } from "@/server/db/client";
import {
  clients, employees, projectMembers, projects, taskCategories, type ClientRow, type ProjectRow, type TaskCategoryRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";

const CURRENT = inArray(employees.status, ["active", "on_notice"]);

function requireClient(db: DbLike, id: number): ClientRow {
  const row = db.select().from(clients).where(eq(clients.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Client not found.");
  return row;
}

export function requireProject(db: DbLike, id: number): ProjectRow {
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Project not found.");
  return row;
}

function requireCategory(db: DbLike, id: number): TaskCategoryRow {
  const row = db.select().from(taskCategories).where(eq(taskCategories.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Task category not found.");
  return row;
}

// ---------------------------------------------------------------------------------------------------------------
// Clients

function assertClientUnique(db: DbLike, input: ClientInput, exceptId: number | null): void {
  const others = exceptId === null ? undefined : ne(clients.id, exceptId);
  if (db.select({ id: clients.id }).from(clients).where(and(sql`lower(${clients.name}) = ${input.name.toLowerCase()}`, others)).get()) {
    throw new DomainError("DUPLICATE_NAME", "A client with this name already exists.", { name: ["Already exists"] });
  }
  if (input.code && db.select({ id: clients.id }).from(clients).where(and(eq(clients.code, input.code), others)).get()) {
    throw new DomainError("DUPLICATE_CODE", "This client code is already used.", { code: ["Already used"] });
  }
}

export function createClient(db: DbLike, input: ClientInput): ClientRow {
  assertClientUnique(db, input, null);
  return db.insert(clients).values(input).returning().get();
}

export function updateClient(db: DbLike, id: number, input: ClientInput): { before: ClientRow; after: ClientRow } {
  const before = requireClient(db, id);
  assertClientUnique(db, input, id);
  const after = db.update(clients).set(input).where(eq(clients.id, id)).returning().get()!;
  return { before, after };
}

/** A client can be archived once none of its projects is active or on hold. */
export function setClientArchived(db: DbLike, id: number, archived: boolean): ClientRow {
  requireClient(db, id);
  if (archived) {
    const open = db
      .select({ n: count() })
      .from(projects)
      .where(and(eq(projects.clientId, id), inArray(projects.status, ["active", "on_hold"])))
      .get()?.n ?? 0;
    if (open > 0) throw new DomainError("CLIENT_IN_USE", `Close this client's ${open} open project(s) first.`);
  }
  return db.update(clients).set({ archived }).where(eq(clients.id, id)).returning().get()!;
}

// ---------------------------------------------------------------------------------------------------------------
// Task categories

function assertCategoryUnique(db: DbLike, name: string, exceptId: number | null): void {
  const others = exceptId === null ? undefined : ne(taskCategories.id, exceptId);
  if (db.select({ id: taskCategories.id }).from(taskCategories).where(and(sql`lower(${taskCategories.name}) = ${name.toLowerCase()}`, others)).get()) {
    throw new DomainError("DUPLICATE_NAME", "A task category with this name already exists.", { name: ["Already exists"] });
  }
}

export function createCategory(db: DbLike, input: CategoryInput): TaskCategoryRow {
  assertCategoryUnique(db, input.name, null);
  const last = db.select({ n: sql<number>`coalesce(max(${taskCategories.sortOrder}), 0)` }).from(taskCategories).get()?.n ?? 0;
  return db.insert(taskCategories).values({ ...input, sortOrder: last + 1 }).returning().get();
}

export function updateCategory(db: DbLike, id: number, input: CategoryInput): { before: TaskCategoryRow; after: TaskCategoryRow } {
  const before = requireCategory(db, id);
  assertCategoryUnique(db, input.name, id);
  const after = db.update(taskCategories).set(input).where(eq(taskCategories.id, id)).returning().get()!;
  return { before, after };
}

/** Archived categories keep their logged time but take no new rows. */
export function setCategoryArchived(db: DbLike, id: number, archived: boolean): TaskCategoryRow {
  requireCategory(db, id);
  return db.update(taskCategories).set({ archived }).where(eq(taskCategories.id, id)).returning().get()!;
}

// ---------------------------------------------------------------------------------------------------------------
// Projects and members

function assertCurrentEmployees(db: DbLike, ids: number[], field: string): void {
  if (ids.length === 0) return;
  const current = db.select({ id: employees.id }).from(employees).where(and(inArray(employees.id, ids), CURRENT)).all();
  if (current.length !== new Set(ids).size) {
    throw new DomainError("NOT_CURRENT", "Choose current employees only.", { [field]: ["Not a current employee"] });
  }
}

function assertProject(db: DbLike, input: ProjectInput, exceptId: number | null, before: ProjectRow | null): void {
  const others = exceptId === null ? undefined : ne(projects.id, exceptId);
  if (db.select({ id: projects.id }).from(projects).where(and(eq(projects.code, input.code), others)).get()) {
    throw new DomainError("DUPLICATE_CODE", "This project code is already used.", { code: ["Already used"] });
  }
  if (input.clientId !== null && input.clientId !== before?.clientId && requireClient(db, input.clientId).archived) {
    throw new DomainError("ARCHIVED", "Choose an active client.", { clientId: ["Archived"] });
  }
  if (input.managerEmployeeId !== null && input.managerEmployeeId !== before?.managerEmployeeId) {
    assertCurrentEmployees(db, [input.managerEmployeeId], "managerEmployeeId");
  }
}

export function createProject(db: DbLike, input: ProjectInput): ProjectRow {
  assertProject(db, input, null, null);
  return db.insert(projects).values(input).returning().get();
}

export function updateProject(db: DbLike, id: number, input: ProjectInput): { before: ProjectRow; after: ProjectRow } {
  const before = requireProject(db, id);
  assertProject(db, input, id, before);
  const after = db.update(projects).set(input).where(eq(projects.id, id)).returning().get()!;
  return { before, after };
}

/** Adds current employees to a project; members who were removed come back with the new role. Returns how many. */
export function addMembers(db: DbLike, projectId: number, employeeIds: number[], role: string | null): number {
  requireProject(db, projectId);
  const ids = [...new Set(employeeIds)];
  assertCurrentEmployees(db, ids, "employeeIds");
  for (const employeeId of ids) {
    db.insert(projectMembers)
      .values({ projectId, employeeId, role, active: true })
      .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.employeeId], set: { role, active: true } })
      .run();
  }
  return ids.length;
}

/** Removing a member deactivates them, so their logged time keeps its context. */
export function setMemberActive(db: DbLike, projectId: number, employeeId: number, active: boolean): void {
  const key = and(eq(projectMembers.projectId, projectId), eq(projectMembers.employeeId, employeeId));
  if (!db.select().from(projectMembers).where(key).get()) throw new DomainError("NOT_FOUND", "Not a member of this project.");
  db.update(projectMembers).set({ active }).where(key).run();
}

// ---------------------------------------------------------------------------------------------------------------

const DEFAULT_CATEGORIES: CategoryInput[] = [
  { name: "Development", billableDefault: true },
  { name: "Design", billableDefault: true },
  { name: "Testing", billableDefault: true },
  { name: "Meetings", billableDefault: true },
  { name: "Documentation", billableDefault: true },
  { name: "Support", billableDefault: true },
  { name: "Training", billableDefault: false },
  { name: "Internal admin", billableDefault: false },
];

/** Default task categories and the "Internal" project everyone can log to. Idempotent; never touches existing rows. */
export function seedTimesheetDefaults(db: DbLike): void {
  if (!db.select({ id: taskCategories.id }).from(taskCategories).get()) {
    DEFAULT_CATEGORIES.forEach((c, i) => db.insert(taskCategories).values({ ...c, sortOrder: i + 1 }).run());
  }
  if (!db.select({ id: projects.id }).from(projects).where(eq(projects.code, "INT")).get()) {
    db.insert(projects).values({ code: "INT", name: "Internal", clientId: null, billableDefault: false, status: "active" }).run();
  }
}
