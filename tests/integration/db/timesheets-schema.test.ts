import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { clients, projects, taskCategories, timesheetEntries, timesheets } from "@/server/db/schema";
import { createTestDb } from "../../helpers/db";
import { insertEmployee } from "../../helpers/employees";

function setup() {
  const db = createTestDb();
  const e = insertEmployee(db);
  const client = db.insert(clients).values({ name: "Acme", code: "ACME" }).returning().get();
  const project = db.insert(projects).values({ clientId: client.id, code: "WEB", name: "Website" }).returning().get();
  const category = db.insert(taskCategories).values({ name: "Development" }).returning().get();
  return { db, e, client, project, category };
}

describe("timesheet schema", () => {
  it("creates the project and timesheet tables", () => {
    const db = createTestDb();
    const names = db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`).map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining(["clients", "projects", "project_members", "task_categories", "timesheets", "timesheet_entries", "running_timers"]),
    );
  });

  it("keeps one timesheet per employee and week, and one entry per cell", () => {
    const { db, e, project, category } = setup();
    const week = db.insert(timesheets).values({ employeeId: e.id, weekStart: "2026-10-19" }).returning().get();
    expect(week).toMatchObject({ status: "draft", submittedAt: null });
    expect(() => db.insert(timesheets).values({ employeeId: e.id, weekStart: "2026-10-19" }).run()).toThrow(/UNIQUE/);
    const cell = { timesheetId: week.id, projectId: project.id, taskCategoryId: category.id, date: "2026-10-19", minutes: 60, billable: true };
    db.insert(timesheetEntries).values(cell).run();
    expect(() => db.insert(timesheetEntries).values(cell).run()).toThrow(/UNIQUE/);
    db.delete(timesheets).where(eq(timesheets.id, week.id)).run();
    expect(db.select().from(timesheetEntries).all()).toEqual([]);
  });

  it("keeps clients with projects from being deleted, and allows several clients without a code", () => {
    const { db, client } = setup();
    expect(() => db.delete(clients).where(eq(clients.id, client.id)).run()).toThrow(/FOREIGN KEY/);
    db.insert(clients).values([{ name: "One" }, { name: "Two" }]).run();
    expect(db.select().from(clients).all()).toHaveLength(3);
  });
});
