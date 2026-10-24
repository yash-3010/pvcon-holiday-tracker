"use server";

import { z } from "zod";
import { departmentSchema } from "@/lib/validation/org";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { createDepartment, setDepartmentArchived, updateDepartment } from "@/server/modules/org/service";

const PATHS = ["/org/departments"];

export const createDepartmentAction = defineAction({
  name: "departments.create",
  schema: departmentSchema,
  permission: "org.manage",
  handler: ({ tx, audit }, input) => {
    const row = createDepartment(tx, input);
    audit({ action: "department.create", entityType: "department", entityId: row.id, summary: `Created department ${row.name}` });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateDepartmentAction = defineAction({
  name: "departments.update",
  schema: departmentSchema.extend({ id: z.number().int().positive() }),
  permission: "org.manage",
  handler: ({ tx, audit }, { id, ...input }) => {
    const { before, after } = updateDepartment(tx, id, input);
    audit({
      action: "department.update", entityType: "department", entityId: id,
      summary: `Updated department ${after.name}`, diff: diffObjects(before, after),
    });
    return { id };
  },
  revalidate: PATHS,
});

export const archiveDepartmentAction = defineAction({
  name: "departments.archive",
  schema: z.object({ id: z.number().int().positive(), archived: z.boolean() }),
  permission: "org.manage",
  handler: ({ tx, audit }, { id, archived }) => {
    const row = setDepartmentArchived(tx, id, archived);
    audit({
      action: archived ? "department.archive" : "department.restore", entityType: "department", entityId: id,
      summary: `${archived ? "Archived" : "Restored"} department ${row.name}`,
    });
    return { archived: row.archived };
  },
  revalidate: PATHS,
});
