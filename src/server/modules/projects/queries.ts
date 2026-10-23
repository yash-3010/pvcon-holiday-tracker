import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { SelectOption } from "@/lib/hr";
import type { ProjectStatus } from "@/lib/timesheets";
import type { DbLike } from "@/server/db/client";
import {
  clients, employees, projectMembers, projects, taskCategories, timesheetEntries, timesheets, type ClientRow, type ProjectRow,
  type TaskCategoryRow,
} from "@/server/db/schema";

/** Time that counts against a budget: weeks submitted or approved. Drafts are shown apart. */
const BOOKED = inArray(timesheets.status, ["submitted", "approved"]);

export type ClientListItem = ClientRow & { projects: number };

export function listClients(db: DbLike): ClientListItem[] {
  const counts = new Map(
    db
      .select({ clientId: projects.clientId, n: count() })
      .from(projects)
      .groupBy(projects.clientId)
      .all()
      .map((r) => [r.clientId, r.n]),
  );
  return db
    .select()
    .from(clients)
    .orderBy(asc(clients.name))
    .all()
    .map((c) => ({ ...c, projects: counts.get(c.id) ?? 0 }));
}

export function listCategories(db: DbLike, { includeArchived = false }: { includeArchived?: boolean }): TaskCategoryRow[] {
  return db
    .select()
    .from(taskCategories)
    .where(includeArchived ? undefined : eq(taskCategories.archived, false))
    .orderBy(asc(taskCategories.sortOrder), asc(taskCategories.name))
    .all();
}

export type ProjectListItem = ProjectRow & { clientName: string | null; managerName: string | null; members: number; bookedMinutes: number };

/** Projects by code with their client, active member count and booked time. */
export function listProjects(db: DbLike, { status, clientId }: { status?: ProjectStatus; clientId?: number }): ProjectListItem[] {
  const members = new Map(
    db
      .select({ projectId: projectMembers.projectId, n: count() })
      .from(projectMembers)
      .where(eq(projectMembers.active, true))
      .groupBy(projectMembers.projectId)
      .all()
      .map((r) => [r.projectId, r.n]),
  );
  const booked = new Map(
    db
      .select({ projectId: timesheetEntries.projectId, minutes: sql<number>`sum(${timesheetEntries.minutes})` })
      .from(timesheetEntries)
      .innerJoin(timesheets, eq(timesheets.id, timesheetEntries.timesheetId))
      .where(BOOKED)
      .groupBy(timesheetEntries.projectId)
      .all()
      .map((r) => [r.projectId, r.minutes]),
  );
  return db
    .select({ project: projects, clientName: clients.name, managerName: employees.displayName })
    .from(projects)
    .leftJoin(clients, eq(clients.id, projects.clientId))
    .leftJoin(employees, eq(employees.id, projects.managerEmployeeId))
    .where(and(status ? eq(projects.status, status) : undefined, clientId ? eq(projects.clientId, clientId) : undefined))
    .orderBy(asc(projects.code))
    .all()
    .map((r) => ({
      ...r.project, clientName: r.clientName, managerName: r.managerName, members: members.get(r.project.id) ?? 0,
      bookedMinutes: booked.get(r.project.id) ?? 0,
    }));
}

export interface ProjectMemberView {
  employeeId: number;
  name: string;
  code: string;
  role: string | null;
  active: boolean;
}

export function projectMembersOf(db: DbLike, projectId: number): ProjectMemberView[] {
  return db
    .select({
      employeeId: projectMembers.employeeId, name: employees.displayName, code: employees.employeeCode, role: projectMembers.role,
      active: projectMembers.active,
    })
    .from(projectMembers)
    .innerJoin(employees, eq(employees.id, projectMembers.employeeId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(employees.displayName))
    .all();
}

export function clientOptions(db: DbLike): SelectOption[] {
  return db
    .select({ id: clients.id, label: clients.name })
    .from(clients)
    .where(eq(clients.archived, false))
    .orderBy(asc(clients.name))
    .all();
}

export interface ProjectDetail {
  project: ProjectListItem;
  members: ProjectMemberView[];
  /** Minutes by status bucket: booked (submitted + approved) and draft. */
  burn: { bookedMinutes: number; approvedMinutes: number; draftMinutes: number; budgetMinutes: number | null };
  byEmployee: { employeeId: number; name: string; minutes: number; billableMinutes: number }[];
  byCategory: { categoryId: number; name: string; minutes: number }[];
}

/** The project page: members, budget burn, and booked time by person and by category. */
export function projectDetail(db: DbLike, projectId: number): ProjectDetail | null {
  const project = listProjects(db, {}).find((p) => p.id === projectId);
  if (!project) return null;
  const totals = db
    .select({ status: timesheets.status, minutes: sql<number>`sum(${timesheetEntries.minutes})` })
    .from(timesheetEntries)
    .innerJoin(timesheets, eq(timesheets.id, timesheetEntries.timesheetId))
    .where(eq(timesheetEntries.projectId, projectId))
    .groupBy(timesheets.status)
    .all();
  const of = (...statuses: string[]) => totals.filter((t) => statuses.includes(t.status)).reduce((s, t) => s + t.minutes, 0);
  const scope = and(eq(timesheetEntries.projectId, projectId), BOOKED);
  return {
    project,
    members: projectMembersOf(db, projectId),
    burn: {
      bookedMinutes: of("submitted", "approved"),
      approvedMinutes: of("approved"),
      draftMinutes: of("draft", "rejected"),
      budgetMinutes: project.budgetHours === null ? null : project.budgetHours * 60,
    },
    byEmployee: db
      .select({
        employeeId: timesheets.employeeId, name: employees.displayName, minutes: sql<number>`sum(${timesheetEntries.minutes})`,
        billableMinutes: sql<number>`sum(case when ${timesheetEntries.billable} then ${timesheetEntries.minutes} else 0 end)`,
      })
      .from(timesheetEntries)
      .innerJoin(timesheets, eq(timesheets.id, timesheetEntries.timesheetId))
      .innerJoin(employees, eq(employees.id, timesheets.employeeId))
      .where(scope)
      .groupBy(timesheets.employeeId)
      .orderBy(sql`3 desc`)
      .all(),
    byCategory: db
      .select({ categoryId: taskCategories.id, name: taskCategories.name, minutes: sql<number>`sum(${timesheetEntries.minutes})` })
      .from(timesheetEntries)
      .innerJoin(timesheets, eq(timesheets.id, timesheetEntries.timesheetId))
      .innerJoin(taskCategories, eq(taskCategories.id, timesheetEntries.taskCategoryId))
      .where(scope)
      .groupBy(taskCategories.id)
      .orderBy(sql`3 desc`)
      .all(),
  };
}
