import { and, asc, desc, eq } from "drizzle-orm";
import type { ChecklistItemState, ChecklistKind, ChecklistTemplateItem } from "@/lib/hr";
import type { ChecklistTemplateInput } from "@/lib/validation/org";
import type { DbLike } from "@/server/db/client";
import { nowIso } from "@/server/db/columns";
import {
  checklistTemplates, employeeChecklists, type ChecklistTemplateRow, type EmployeeChecklistRow,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";

const DEFAULT_TEMPLATES: { kind: ChecklistKind; name: string; items: ChecklistTemplateItem[] }[] = [
  {
    kind: "onboarding",
    name: "Standard onboarding",
    items: [
      { label: "Collect the signed offer letter", owner: "hr" },
      { label: "Collect ID and address proofs", owner: "employee" },
      { label: "Add bank details", owner: "employee" },
      { label: "Create email and system accounts", owner: "it" },
      { label: "Issue laptop and ID card", owner: "it" },
      { label: "Introduce to the team and set first-week goals", owner: "manager" },
    ],
  },
  {
    kind: "offboarding",
    name: "Standard offboarding",
    items: [
      { label: "Accept the resignation and confirm the last working day", owner: "hr" },
      { label: "Complete knowledge transfer", owner: "manager" },
      { label: "Return laptop, ID card and other assets", owner: "employee" },
      { label: "Revoke email and system access", owner: "it" },
      { label: "Hold the exit interview", owner: "hr" },
      { label: "Process the full and final settlement", owner: "hr" },
    ],
  },
];

function clearDefault(db: DbLike, kind: ChecklistKind): void {
  db.update(checklistTemplates)
    .set({ isDefault: false })
    .where(and(eq(checklistTemplates.kind, kind), eq(checklistTemplates.isDefault, true)))
    .run();
}

function requireTemplate(db: DbLike, id: number): ChecklistTemplateRow {
  const row = db.select().from(checklistTemplates).where(eq(checklistTemplates.id, id)).get();
  if (!row) throw new DomainError("NOT_FOUND", "Checklist template not found.");
  return row;
}

export function createChecklistTemplate(db: DbLike, input: ChecklistTemplateInput): ChecklistTemplateRow {
  if (input.isDefault) clearDefault(db, input.kind);
  return db.insert(checklistTemplates).values(input).returning().get();
}

export function updateChecklistTemplate(
  db: DbLike,
  id: number,
  input: ChecklistTemplateInput,
): { before: ChecklistTemplateRow; after: ChecklistTemplateRow } {
  const before = requireTemplate(db, id);
  if (before.archived && input.isDefault) {
    throw new DomainError("ARCHIVED", "Restore this template before making it the default.");
  }
  if (input.isDefault) clearDefault(db, input.kind);
  const after = db.update(checklistTemplates).set(input).where(eq(checklistTemplates.id, id)).returning().get()!;
  return { before, after };
}

export function setChecklistTemplateArchived(db: DbLike, id: number, archived: boolean): ChecklistTemplateRow {
  requireTemplate(db, id);
  return db
    .update(checklistTemplates)
    .set(archived ? { archived, isDefault: false } : { archived })
    .where(eq(checklistTemplates.id, id))
    .returning()
    .get()!;
}

export function listChecklistTemplates(db: DbLike): ChecklistTemplateRow[] {
  return db.select().from(checklistTemplates).orderBy(asc(checklistTemplates.kind), asc(checklistTemplates.name)).all();
}

/** Copies the default template of `kind` onto the employee; null when there is no active default. */
export function instantiateChecklist(db: DbLike, employeeId: number, kind: ChecklistKind): EmployeeChecklistRow | null {
  const template = db
    .select()
    .from(checklistTemplates)
    .where(and(eq(checklistTemplates.kind, kind), eq(checklistTemplates.isDefault, true), eq(checklistTemplates.archived, false)))
    .get();
  if (!template) return null;
  return db
    .insert(employeeChecklists)
    .values({
      employeeId,
      templateId: template.id,
      kind,
      name: template.name,
      items: template.items.map((item) => ({ ...item, doneAt: null, doneBy: null, doneByName: null })),
    })
    .returning()
    .get();
}

export function listEmployeeChecklists(db: DbLike, employeeId: number): EmployeeChecklistRow[] {
  return db
    .select()
    .from(employeeChecklists)
    .where(eq(employeeChecklists.employeeId, employeeId))
    .orderBy(desc(employeeChecklists.createdAt), desc(employeeChecklists.id))
    .all();
}

export function getEmployeeChecklist(db: DbLike, id: number): EmployeeChecklistRow | undefined {
  return db.select().from(employeeChecklists).where(eq(employeeChecklists.id, id)).get();
}

/** Ticks or unticks one item. The checklist completes when every item is done and reopens when one is unticked. */
export function toggleChecklistItem(
  db: DbLike,
  checklistId: number,
  index: number,
  done: boolean,
  actor: { id: number; name: string },
): EmployeeChecklistRow {
  const checklist = getEmployeeChecklist(db, checklistId);
  if (!checklist) throw new DomainError("NOT_FOUND", "Checklist not found.");
  if (checklist.status === "cancelled") throw new DomainError("CHECKLIST_CANCELLED", "This checklist was cancelled.");
  if (!Number.isInteger(index) || index < 0 || index >= checklist.items.length) {
    throw new DomainError("NOT_FOUND", "Checklist item not found.");
  }
  const items: ChecklistItemState[] = checklist.items.map((item, i) => {
    if (i !== index) return item;
    return done
      ? { ...item, doneAt: nowIso(), doneBy: actor.id, doneByName: actor.name }
      : { ...item, doneAt: null, doneBy: null, doneByName: null };
  });
  const status = items.every((item) => item.doneAt !== null) ? "completed" : "open";
  return db.update(employeeChecklists).set({ items, status }).where(eq(employeeChecklists.id, checklistId)).returning().get()!;
}

export function cancelOpenChecklists(db: DbLike, employeeId: number, kind: ChecklistKind): number {
  return db
    .update(employeeChecklists)
    .set({ status: "cancelled" })
    .where(and(eq(employeeChecklists.employeeId, employeeId), eq(employeeChecklists.kind, kind), eq(employeeChecklists.status, "open")))
    .run().changes;
}

/** Idempotent: adds the standard template for each kind that has no templates yet. */
export function seedDefaultChecklistTemplates(db: DbLike): number {
  let created = 0;
  for (const template of DEFAULT_TEMPLATES) {
    const exists = db.select({ id: checklistTemplates.id }).from(checklistTemplates).where(eq(checklistTemplates.kind, template.kind)).get();
    if (exists) continue;
    db.insert(checklistTemplates).values({ ...template, isDefault: true }).run();
    created += 1;
  }
  return created;
}
