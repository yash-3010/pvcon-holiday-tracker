import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { notifications, users } from "@/server/db/schema";
import { allAnnouncements, currentAnnouncements } from "@/server/modules/announcements/queries";
import {
  createAnnouncement, deleteAnnouncement, publishDueAnnouncements, updateAnnouncement,
} from "@/server/modules/announcements/service";
import { createTestDb } from "../helpers/db";
import { expectDomainError, insertUser } from "../helpers/fixtures";

let db: DB;
let hrId: number;
const TZ = "Asia/Kolkata";
// 10 Nov 2026, 11:30 in India.
const NOW = new Date("2026-11-10T06:00:00Z");
const input = (overrides: Partial<Parameters<typeof createAnnouncement>[2]> = {}) => ({
  title: "Diwali party", body: "Friday at 5 pm on the terrace.", pinned: false, publishOn: "2026-11-10", showUntil: null, ...overrides,
});
const published = () => db.select().from(notifications).where(eq(notifications.type, "announcement.published")).all();

beforeEach(() => {
  db = createTestDb();
  hrId = insertUser(db, { roles: ["hr_admin"] }).id;
  insertUser(db);
  const gone = insertUser(db);
  db.update(users).set({ status: "disabled" }).where(eq(users.id, gone.id)).run();
});

describe("announcements", () => {
  it("publish now or on their day, notifying every active user once", () => {
    const now = createAnnouncement(db, hrId, input(), { now: NOW, timeZone: TZ });
    expect(now.publishAt).toBe("2026-11-09T18:30:00.000Z");
    expect(published()).toHaveLength(2);
    const later = createAnnouncement(db, hrId, input({ title: "Year-end close", publishOn: "2026-11-12" }), { now: NOW, timeZone: TZ });
    expect(published()).toHaveLength(2);
    expect(publishDueAnnouncements(db, new Date("2026-11-11T19:00:00Z"))).toBe(1);
    expect(publishDueAnnouncements(db, new Date("2026-11-11T19:00:00Z"))).toBe(0);
    expect(published().map((n) => n.title)).toEqual(["Diwali party", "Diwali party", "Year-end close", "Year-end close"]);
    expect(published()[0]!.link).toBe("/announcements");
    updateAnnouncement(db, later.id, input({ title: "Year-end close (moved)", publishOn: "2026-11-12" }), { now: NOW, timeZone: TZ });
    expect(published()).toHaveLength(4);
  });

  it("show current ones pinned first, hide scheduled and expired ones from everyone but managers", () => {
    const a = createAnnouncement(db, hrId, input({ title: "Old news", showUntil: "2026-11-09", publishOn: "2026-11-01" }), { now: NOW, timeZone: TZ });
    createAnnouncement(db, hrId, input({ title: "Latest" }), { now: NOW, timeZone: TZ });
    createAnnouncement(db, hrId, input({ title: "Pinned", pinned: true, publishOn: "2026-11-05" }), { now: NOW, timeZone: TZ });
    createAnnouncement(db, hrId, input({ title: "Next week", publishOn: "2026-11-17" }), { now: NOW, timeZone: TZ });
    expect(currentAnnouncements(db, NOW).map((x) => x.title)).toEqual(["Pinned", "Latest"]);
    expect(allAnnouncements(db, NOW).map((x) => [x.title, x.state])).toEqual([
      ["Next week", "scheduled"], ["Latest", "live"], ["Pinned", "live"], ["Old news", "expired"],
    ]);
    expectDomainError(() => createAnnouncement(db, hrId, input({ showUntil: "2026-11-09" }), { now: NOW, timeZone: TZ }), "INVALID_DATES");
    deleteAnnouncement(db, a.id);
    expect(allAnnouncements(db, NOW)).toHaveLength(3);
  });
});
