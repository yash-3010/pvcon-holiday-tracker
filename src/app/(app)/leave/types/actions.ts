"use server";

import { z } from "zod";
import { leaveTypeSchema, updateLeaveTypeSchema } from "@/lib/validation/leave";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { createLeaveType, setLeaveTypeArchived, updateLeaveType } from "@/server/modules/leave/types";

const PATHS = ["/leave/types", "/me/leave", "/leave/balances"];

export const createLeaveTypeAction = defineAction({
  name: "leave_types.create",
  schema: leaveTypeSchema,
  permission: "leave.config",
  handler: ({ tx, audit }, input) => {
    const row = createLeaveType(tx, input);
    audit({ action: "leave_type.create", entityType: "leave_type", entityId: row.id, summary: `Created leave type ${row.code} (${row.name})` });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateLeaveTypeAction = defineAction({
  name: "leave_types.update",
  schema: updateLeaveTypeSchema,
  permission: "leave.config",
  handler: ({ tx, audit }, { id, ...input }) => {
    const { before, after } = updateLeaveType(tx, id, input);
    audit({
      action: "leave_type.update", entityType: "leave_type", entityId: id,
      summary: `Updated leave type ${after.code} (${after.name})`, diff: diffObjects(before, after),
    });
    return { id };
  },
  revalidate: PATHS,
});

export const archiveLeaveTypeAction = defineAction({
  name: "leave_types.archive",
  schema: z.object({ id: z.number().int().positive(), archived: z.boolean() }),
  permission: "leave.config",
  handler: ({ tx, audit }, { id, archived }) => {
    const row = setLeaveTypeArchived(tx, id, archived);
    audit({
      action: archived ? "leave_type.archive" : "leave_type.restore", entityType: "leave_type", entityId: id,
      summary: `${archived ? "Archived" : "Restored"} leave type ${row.code}`,
    });
    return { archived: row.archived };
  },
  revalidate: PATHS,
});
