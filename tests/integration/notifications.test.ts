import { beforeEach, describe, expect, it } from "vitest";
import type { DB } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { listNotifications, markRead, notify, notifyMany, unreadCount } from "@/server/modules/notifications/service";
import { createTestDb } from "../helpers/db";

let db: DB;
let a: number;
let b: number;
beforeEach(() => {
  db = createTestDb();
  a = db.insert(users).values({ email: "a@pvcon.in", name: "A", passwordHash: "x" }).returning().get().id;
  b = db.insert(users).values({ email: "b@pvcon.in", name: "B", passwordHash: "x" }).returning().get().id;
});

describe("notifications", () => {
  it("creates, lists newest first and counts unread", () => {
    notify(db, { userId: a, type: "test", title: "First" });
    notify(db, { userId: a, type: "test", title: "Second", link: "/x" });
    notifyMany(db, [a, b], { type: "announce", title: "Hello" });
    expect(unreadCount(db, a)).toBe(3);
    expect(unreadCount(db, b)).toBe(1);
    expect(listNotifications(db, a).map((n) => n.title)).toEqual(["Hello", "Second", "First"]);
    expect(listNotifications(db, a, { limit: 1 })).toHaveLength(1);
  });

  it("marks only the owner's notifications as read", () => {
    notify(db, { userId: a, type: "t", title: "A1" });
    notify(db, { userId: b, type: "t", title: "B1" });
    const bId = listNotifications(db, b)[0].id;
    expect(markRead(db, a, [bId])).toBe(0);
    expect(unreadCount(db, b)).toBe(1);
    const aId = listNotifications(db, a)[0].id;
    expect(markRead(db, a, [aId])).toBe(1);
    expect(listNotifications(db, a, { unreadOnly: true })).toHaveLength(0);
  });

  it("marks all as read", () => {
    notify(db, { userId: a, type: "t", title: "1" });
    notify(db, { userId: a, type: "t", title: "2" });
    expect(markRead(db, a, "all")).toBe(2);
    expect(unreadCount(db, a)).toBe(0);
  });
});
