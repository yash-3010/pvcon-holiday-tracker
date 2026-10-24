"use server";

import { z } from "zod";
import { designationSchema } from "@/lib/validation/org";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { createDesignation, setDesignationArchived, updateDesignation } from "@/server/modules/org/service";

const PATHS = ["/org/designations"];

export const createDesignationAction = defineAction({
  name: "designations.create",
  schema: designationSchema,
  permission: "org.manage",
  handler: ({ tx, audit }, input) => {
    const row = createDesignation(tx, input);
    audit({ action: "designation.create", entityType: "designation", entityId: row.id, summary: `Created designation ${row.name}` });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateDesignationAction = defineAction({
  name: "designations.update",
  schema: designationSchema.extend({ id: z.number().int().positive() }),
  permission: "org.manage",
  handler: ({ tx, audit }, { id, ...input }) => {
    const { before, after } = updateDesignation(tx, id, input);
    audit({
      action: "designation.update", entityType: "designation", entityId: id,
      summary: `Updated designation ${after.name}`, diff: diffObjects(before, after),
    });
    return { id };
  },
  revalidate: PATHS,
});

export const archiveDesignationAction = defineAction({
  name: "designations.archive",
  schema: z.object({ id: z.number().int().positive(), archived: z.boolean() }),
  permission: "org.manage",
  handler: ({ tx, audit }, { id, archived }) => {
    const row = setDesignationArchived(tx, id, archived);
    audit({
      action: archived ? "designation.archive" : "designation.restore", entityType: "designation", entityId: id,
      summary: `${archived ? "Archived" : "Restored"} designation ${row.name}`,
    });
    return { archived: row.archived };
  },
  revalidate: PATHS,
});
