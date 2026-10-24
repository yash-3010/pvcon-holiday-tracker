import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/server/db/client";
import { users, type UserRow } from "@/server/db/schema";
import { createTestDb } from "../helpers/db";
import { insertUser } from "../helpers/fixtures";

// Only Auth.js and Next's navigation interrupts are replaced; the DB lookup is real.
const state = vi.hoisted(() => ({
  db: undefined as unknown as DB,
  session: null as null | { user: { id: string; sessionVersion: number } },
}));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  forbidden: () => {
    throw new Error("FORBIDDEN");
  },
}));

import { getCurrentUser, requireAnyPermission, requirePermission, requireUser } from "@/server/auth/session";

let employee: UserRow;
let admin: UserRow;
const signIn = (user: UserRow, sessionVersion = user.sessionVersion) => {
  state.session = { user: { id: String(user.id), sessionVersion } };
};

beforeEach(() => {
  state.db = createTestDb();
  state.session = null;
  employee = insertUser(state.db, { roles: ["employee"] });
  admin = insertUser(state.db, { roles: ["super_admin"] });
});

describe("getCurrentUser", () => {
  it("loads the user and roles from the database", async () => {
    signIn(admin);
    await expect(getCurrentUser()).resolves.toMatchObject({ id: admin.id, roles: ["super_admin"] });
  });

  it("returns null without a session or with a malformed user id", async () => {
    await expect(getCurrentUser()).resolves.toBeNull();
    state.session = { user: { id: "", sessionVersion: 0 } };
    await expect(getCurrentUser()).resolves.toBeNull();
    state.session = { user: { id: "1.5", sessionVersion: 0 } };
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("returns null once the session version is bumped", async () => {
    signIn(employee);
    state.db.update(users).set({ sessionVersion: employee.sessionVersion + 1 }).where(eq(users.id, employee.id)).run();
    await expect(getCurrentUser()).resolves.toBeNull();
  });
});

describe("requireUser / requirePermission", () => {
  it("redirects anonymous visitors to the login page", async () => {
    await expect(requireUser()).rejects.toThrow("REDIRECT /login");
  });

  it("forbids users without the permission and returns those with it", async () => {
    signIn(employee);
    await expect(requirePermission("settings.manage")).rejects.toThrow("FORBIDDEN");
    await expect(requireAnyPermission(["audit.view", "job.run"])).rejects.toThrow("FORBIDDEN");
    signIn(admin);
    await expect(requirePermission("settings.manage")).resolves.toMatchObject({ id: admin.id });
    await expect(requireAnyPermission(["audit.view", "job.run"])).resolves.toMatchObject({ id: admin.id });
  });
});
