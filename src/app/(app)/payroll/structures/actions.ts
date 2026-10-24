"use server";

import { z } from "zod";
import { structureSchema } from "@/lib/validation/payroll";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { createStructure, setStructureArchived, updateStructure } from "@/server/modules/payroll/structures";

const id = z.number().int().positive();
const PATHS = ["/payroll/structures", "/payroll/salaries"];

export const createStructureAction = defineAction({
  name: "payroll.structure.create",
  schema: structureSchema,
  permission: "payroll.configure",
  handler: ({ tx, audit }, input) => {
    const row = createStructure(tx, input);
    audit({ action: "payroll.structure.create", entityType: "salary_structure", entityId: row.id, summary: `Created structure ${row.name}`, diff: { lines: input.lines } });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateStructureAction = defineAction({
  name: "payroll.structure.update",
  schema: structureSchema.extend({ id }),
  permission: "payroll.configure",
  handler: ({ tx, audit }, { id: structureId, ...input }) => {
    const { before, after } = updateStructure(tx, structureId, input);
    audit({
      action: "payroll.structure.update", entityType: "salary_structure", entityId: structureId, summary: `Updated structure ${after.name}`,
      diff: { ...diffObjects(before, after), lines: input.lines },
    });
    return { id: structureId };
  },
  revalidate: PATHS,
});

export const archiveStructureAction = defineAction({
  name: "payroll.structure.archive",
  schema: z.object({ id, archived: z.boolean() }),
  permission: "payroll.configure",
  handler: ({ tx, audit }, { id: structureId, archived }) => {
    const row = setStructureArchived(tx, structureId, archived);
    audit({
      action: archived ? "payroll.structure.archive" : "payroll.structure.restore", entityType: "salary_structure", entityId: structureId,
      summary: `${archived ? "Archived" : "Restored"} structure ${row.name}`,
    });
    return { archived: row.archived };
  },
  revalidate: PATHS,
});
