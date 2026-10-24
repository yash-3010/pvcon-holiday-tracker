"use server";

import { z } from "zod";
import { componentSchema } from "@/lib/validation/payroll";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { createComponent, setComponentArchived } from "@/server/modules/payroll/components";
import { updateComponent } from "@/server/modules/payroll/structures";

const id = z.number().int().positive();
const PATHS = ["/payroll/components", "/payroll/structures"];

export const createComponentAction = defineAction({
  name: "payroll.component.create",
  schema: componentSchema,
  permission: "payroll.configure",
  handler: ({ tx, audit }, input) => {
    const row = createComponent(tx, input);
    audit({ action: "payroll.component.create", entityType: "salary_component", entityId: row.id, summary: `Created component ${row.code}` });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateComponentAction = defineAction({
  name: "payroll.component.update",
  schema: componentSchema.and(z.object({ id })),
  permission: "payroll.configure",
  handler: ({ tx, audit }, { id: componentId, ...input }) => {
    const { before, after } = updateComponent(tx, componentId, input);
    audit({
      action: "payroll.component.update", entityType: "salary_component", entityId: componentId, summary: `Updated component ${after.code}`,
      diff: diffObjects(before, after),
    });
    return { id: componentId };
  },
  revalidate: PATHS,
});

export const archiveComponentAction = defineAction({
  name: "payroll.component.archive",
  schema: z.object({ id, archived: z.boolean() }),
  permission: "payroll.configure",
  handler: ({ tx, audit }, { id: componentId, archived }) => {
    const row = setComponentArchived(tx, componentId, archived);
    audit({
      action: archived ? "payroll.component.archive" : "payroll.component.restore", entityType: "salary_component", entityId: componentId,
      summary: `${archived ? "Archived" : "Restored"} component ${row.code}`,
    });
    return { archived: row.archived };
  },
  revalidate: PATHS,
});
