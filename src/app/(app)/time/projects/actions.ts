"use server";

import { z } from "zod";
import { memberSchema, projectSchema, updateProjectSchema } from "@/lib/validation/timesheets";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { addMembers, createProject, requireProject, setMemberActive, updateProject } from "@/server/modules/projects/service";

const id = z.number().int().positive();
const PATHS = ["/time/projects", "/me/timesheets"];

export const createProjectAction = defineAction({
  name: "projects.create",
  schema: projectSchema,
  permission: "project.manage",
  handler: ({ tx, audit }, input) => {
    const row = createProject(tx, input);
    audit({ action: "project.create", entityType: "project", entityId: row.id, summary: `Created project ${row.code} ${row.name}` });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateProjectAction = defineAction({
  name: "projects.update",
  schema: updateProjectSchema,
  permission: "project.manage",
  handler: ({ tx, audit }, { id: projectId, ...input }) => {
    const { before, after } = updateProject(tx, projectId, input);
    audit({ action: "project.update", entityType: "project", entityId: projectId, summary: `Updated project ${after.code}`, diff: diffObjects(before, after) });
    return { id: projectId };
  },
  revalidate: PATHS,
});

export const addMembersAction = defineAction({
  name: "projects.members.add",
  schema: memberSchema,
  permission: "project.manage",
  handler: ({ tx, audit }, { projectId, employeeIds, role }) => {
    const added = addMembers(tx, projectId, employeeIds, role);
    audit({
      action: "project.members", entityType: "project", entityId: projectId,
      summary: `Added ${added} member(s) to ${requireProject(tx, projectId).code}${role ? ` as ${role}` : ""}`,
      diff: { employeeIds: { from: null, to: employeeIds } },
    });
    return { added };
  },
  revalidate: PATHS,
});

export const setMemberActiveAction = defineAction({
  name: "projects.members.active",
  schema: z.object({ projectId: id, employeeId: id, active: z.boolean() }),
  permission: "project.manage",
  handler: ({ tx, audit }, { projectId, employeeId, active }) => {
    setMemberActive(tx, projectId, employeeId, active);
    audit({
      action: "project.members", entityType: "project", entityId: projectId,
      summary: `${active ? "Restored" : "Removed"} member #${employeeId} on ${requireProject(tx, projectId).code}`,
    });
    return { active };
  },
  revalidate: PATHS,
});
