"use server";

import { z } from "zod";
import { clientSchema } from "@/lib/validation/timesheets";
import { defineAction } from "@/server/actions/define";
import { diffObjects } from "@/server/modules/audit/service";
import { createClient, setClientArchived, updateClient } from "@/server/modules/projects/service";

const id = z.number().int().positive();
const PATHS = ["/time/clients", "/time/projects"];

export const createClientAction = defineAction({
  name: "clients.create",
  schema: clientSchema,
  permission: "project.manage",
  handler: ({ tx, audit }, input) => {
    const row = createClient(tx, input);
    audit({ action: "client.create", entityType: "client", entityId: row.id, summary: `Created client ${row.name}` });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateClientAction = defineAction({
  name: "clients.update",
  schema: clientSchema.extend({ id }),
  permission: "project.manage",
  handler: ({ tx, audit }, { id: clientId, ...input }) => {
    const { before, after } = updateClient(tx, clientId, input);
    audit({ action: "client.update", entityType: "client", entityId: clientId, summary: `Updated client ${after.name}`, diff: diffObjects(before, after) });
    return { id: clientId };
  },
  revalidate: PATHS,
});

export const archiveClientAction = defineAction({
  name: "clients.archive",
  schema: z.object({ id, archived: z.boolean() }),
  permission: "project.manage",
  handler: ({ tx, audit }, { id: clientId, archived }) => {
    const row = setClientArchived(tx, clientId, archived);
    audit({
      action: archived ? "client.archive" : "client.restore", entityType: "client", entityId: clientId,
      summary: `${archived ? "Archived" : "Restored"} client ${row.name}`,
    });
    return { archived: row.archived };
  },
  revalidate: PATHS,
});
