"use server";

import { z } from "zod";
import { shiftSchema } from "@/lib/validation/attendance";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { recomputeToday } from "@/server/modules/attendance/compute";
import {
  assignShift, createShift, employeesOnShift, requireShift, setShiftArchived, updateShift,
} from "@/server/modules/attendance/shifts";

const id = z.number().int().positive();
// A shift change applies from today: today's row is rebuilt, earlier days keep their result.
const PATHS = ["/time/shifts", "/time/attendance", "/time/muster", "/me/attendance", "/settings/attendance"];

export const createShiftAction = defineAction({
  name: "shift.create",
  schema: shiftSchema,
  permission: "shift.manage",
  handler: ({ tx, audit }, input) => {
    const shift = createShift(tx, input);
    audit({ action: "shift.create", entityType: "shift", entityId: shift.id, summary: `Created shift ${shift.name} (${shift.startTime}–${shift.endTime})` });
    return { id: shift.id };
  },
  revalidate: PATHS,
});

export const updateShiftAction = defineAction({
  name: "shift.update",
  schema: shiftSchema.and(z.object({ id })),
  permission: "shift.manage",
  handler: ({ tx, audit }, { id: shiftId, ...input }) => {
    const { before, after } = updateShift(tx, shiftId, input);
    recomputeToday(tx, employeesOnShift(tx, shiftId));
    audit({
      action: "shift.update", entityType: "shift", entityId: shiftId, summary: `Updated shift ${after.name}`,
      diff: diffObjects(before, after),
    });
    return { id: shiftId };
  },
  revalidate: PATHS,
});

export const archiveShiftAction = defineAction({
  name: "shift.archive",
  schema: z.object({ id, archived: z.boolean() }),
  permission: "shift.manage",
  handler: ({ tx, audit }, { id: shiftId, archived }) => {
    const shift = setShiftArchived(tx, shiftId, archived);
    audit({ action: "shift.archive", entityType: "shift", entityId: shiftId, summary: `${archived ? "Archived" : "Restored"} shift ${shift.name}` });
    return { archived: shift.archived };
  },
  revalidate: PATHS,
});

/** `shiftId: null` puts the employees back on the default shift. */
export const assignShiftAction = defineAction({
  name: "shift.assign",
  schema: z.object({ shiftId: id.nullable(), employeeIds: z.array(id).min(1, "Choose at least one employee").max(500) }),
  permission: "shift.manage",
  handler: ({ tx, audit }, { shiftId, employeeIds }) => {
    const name = shiftId === null ? "the default shift" : requireShift(tx, shiftId).name;
    const assigned = assignShift(tx, employeeIds, shiftId);
    recomputeToday(tx, employeeIds);
    audit({
      action: "shift.assign", entityType: "shift", entityId: shiftId ?? "default",
      summary: `Moved ${assigned} employee(s) to ${name}`, diff: { employeeIds: { from: null, to: employeeIds } },
    });
    return { assigned };
  },
  revalidate: [...PATHS, "/org/employees"],
});
