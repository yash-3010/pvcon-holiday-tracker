"use server";

import { z } from "zod";
import { categorySchema } from "@/lib/validation/timesheets";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { createCategory, setCategoryArchived, updateCategory } from "@/server/modules/projects/service";

const id = z.number().int().positive();
const PATHS = ["/time/categories"];

export const createCategoryAction = defineAction({
  name: "categories.create",
  schema: categorySchema,
  permission: "project.manage",
  handler: ({ tx, audit }, input) => {
    const row = createCategory(tx, input);
    audit({ action: "category.create", entityType: "task_category", entityId: row.id, summary: `Created task category ${row.name}` });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateCategoryAction = defineAction({
  name: "categories.update",
  schema: categorySchema.extend({ id }),
  permission: "project.manage",
  handler: ({ tx, audit }, { id: categoryId, ...input }) => {
    const { before, after } = updateCategory(tx, categoryId, input);
    audit({
      action: "category.update", entityType: "task_category", entityId: categoryId, summary: `Updated task category ${after.name}`,
      diff: diffObjects(before, after),
    });
    return { id: categoryId };
  },
  revalidate: PATHS,
});

export const archiveCategoryAction = defineAction({
  name: "categories.archive",
  schema: z.object({ id, archived: z.boolean() }),
  permission: "project.manage",
  handler: ({ tx, audit }, { id: categoryId, archived }) => {
    const row = setCategoryArchived(tx, categoryId, archived);
    audit({
      action: archived ? "category.archive" : "category.restore", entityType: "task_category", entityId: categoryId,
      summary: `${archived ? "Archived" : "Restored"} task category ${row.name}`,
    });
    return { archived: row.archived };
  },
  revalidate: PATHS,
});
