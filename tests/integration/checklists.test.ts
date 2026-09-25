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
