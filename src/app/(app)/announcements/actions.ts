"use server";

import { z } from "zod";
import { announcementSchema } from "@/lib/validation/announcements";
import { defineAction } from "@/server/actions/define";
import type { DbLike } from "@/server/db/client";
import { diffObjects } from "@/server/modules/audit/service";
import { createAnnouncement, deleteAnnouncement, updateAnnouncement } from "@/server/modules/announcements/service";
import { getSetting } from "@/server/modules/settings/service";

const PATHS = ["/announcements", "/"];
const clock = (tx: DbLike) => ({ now: new Date(), timeZone: getSetting(tx, "locale").timezone });

export const createAnnouncementAction = defineAction({
  name: "announcement.create",
  schema: announcementSchema,
  permission: "announcement.manage",
  handler: ({ tx, user, audit }, input) => {
    const row = createAnnouncement(tx, user.id, input, clock(tx));
    audit({ action: "announcement.create", entityType: "announcement", entityId: row.id, summary: `Posted "${row.title}" from ${input.publishOn}` });
    return { id: row.id };
  },
  revalidate: PATHS,
});

export const updateAnnouncementAction = defineAction({
  name: "announcement.update",
  schema: announcementSchema.extend({ id: z.number().int().positive() }),
  permission: "announcement.manage",
  handler: ({ tx, audit }, { id, ...input }) => {
    const { before, after } = updateAnnouncement(tx, id, input, clock(tx));
    audit({ action: "announcement.update", entityType: "announcement", entityId: id, summary: `Edited "${after.title}"`, diff: diffObjects(before, after) });
    return { id };
  },
  revalidate: PATHS,
});

export const deleteAnnouncementAction = defineAction({
  name: "announcement.delete",
  schema: z.object({ id: z.number().int().positive() }),
  permission: "announcement.manage",
  handler: ({ tx, audit }, { id }) => {
    const row = deleteAnnouncement(tx, id);
    audit({ action: "announcement.delete", entityType: "announcement", entityId: id, summary: `Deleted "${row.title}"` });
    return { ok: true };
  },
  revalidate: PATHS,
});
