"use server";

import { z } from "zod";
import { CHECKLIST_KIND_LABELS } from "@/lib/hr";
import { checklistTemplateSchema } from "@/lib/validation/org";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import {
  createChecklistTemplate, setChecklistTemplateArchived, updateChecklistTemplate,
} from "@/server/modules/employees/checklists";

const PATHS = ["/org/checklists"];

export const createChecklistTemplateAction = defineAction({
  name: "checklists.create",
  schema: checklistTemplateSchema,
  permission: "employee.update",
  handler: ({ tx, audit }, input) => {
    const row = createChecklistTemplate(tx, input);
    audit({
      action: "checklist_template.create", entityType: "checklist_template", entityId: row.id,
      summary: `Created ${CHECKLIST_KIND_LABELS[row.kind].toLowerCase()} checklist "${row.name}"`,
    });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateChecklistTemplateAction = defineAction({
  name: "checklists.update",
  schema: checklistTemplateSchema.extend({ id: z.number().int().positive() }),
  permission: "employee.update",
  handler: ({ tx, audit }, { id, ...input }) => {
    const { before, after } = updateChecklistTemplate(tx, id, input);
    audit({
      action: "checklist_template.update", entityType: "checklist_template", entityId: id,
      summary: `Updated checklist "${after.name}"`, diff: diffObjects(before, after),
    });
    return { id };
  },
  revalidate: PATHS,
});

export const archiveChecklistTemplateAction = defineAction({
  name: "checklists.archive",
  schema: z.object({ id: z.number().int().positive(), archived: z.boolean() }),
  permission: "employee.update",
  handler: ({ tx, audit }, { id, archived }) => {
    const row = setChecklistTemplateArchived(tx, id, archived);
    audit({
      action: archived ? "checklist_template.archive" : "checklist_template.restore", entityType: "checklist_template",
      entityId: id, summary: `${archived ? "Archived" : "Restored"} checklist "${row.name}"`,
    });
    return { archived: row.archived };
  },
  revalidate: PATHS,
});
