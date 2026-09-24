import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { notifications, type UserRow } from "@/server/db/schema";
import { notify, unreadCount } from "@/server/modules/notifications/service";
import { createTestDb } from "../helpers/db";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

// Only the Next.js runtime boundary is replaced.
const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { markNotificationsRead } from "@/app/(app)/notifications/actions";

let asha: UserRow;
let ravi: UserRow;
const idsFor = (userId: number) =>
  state.db.select().from(notifications).all().filter((n) => n.userId === userId).map((n) => n.id);

beforeEach(() => {
  state.db = createTestDb();
  asha = insertUser(state.db);
  ravi = insertUser(state.db);
  notify(state.db, { userId: asha.id, type: "test", title: "One" });
  notify(state.db, { userId: asha.id, type: "test", title: "Two" });
  notify(state.db, { userId: ravi.id, type: "test", title: "Ravi's" });
  state.user = sessionUserFor(state.db, asha);
});

describe("markNotificationsRead", () => {
  it("marks only the caller's own notifications, ignoring other users' ids", async () => {
    const [ashaFirst] = idsFor(asha.id);
    const [raviOnly] = idsFor(ravi.id);

    await expect(markNotificationsRead({ ids: [ashaFirst!, raviOnly!] })).resolves.toEqual({ ok: true, data: { updated: 1 } });
    expect(unreadCount(state.db, asha.id)).toBe(1);
    expect(unreadCount(state.db, ravi.id)).toBe(1);
  });

  it("marks all of the caller's notifications when no ids are given", async () => {
    await expect(markNotificationsRead({})).resolves.toEqual({ ok: true, data: { updated: 2 } });
    expect(unreadCount(state.db, asha.id)).toBe(0);
    expect(unreadCount(state.db, ravi.id)).toBe(1);
  });

  it("rejects malformed or oversized id lists", async () => {
    await expect(markNotificationsRead({ ids: [0] })).resolves.toMatchObject({ ok: false, code: "VALIDATION" });
    const tooMany = Array.from({ length: 201 }, (_, i) => i + 1);
    await expect(markNotificationsRead({ ids: tooMany })).resolves.toMatchObject({ ok: false, code: "VALIDATION" });
    expect(unreadCount(state.db, asha.id)).toBe(2);
  });
});
