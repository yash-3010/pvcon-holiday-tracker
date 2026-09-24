import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createTestDb } from "../helpers/db";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

// Only the Next.js runtime boundary is replaced; the executor, DB and audit writer are real.
const state = vi.hoisted(() => ({
  db: undefined as unknown as DB,
  user: null as SessionUser | null,
  revalidated: [] as string[],
}));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "vitest-agent" }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    state.revalidated.push(path);
  },
}));

import { defineAction } from "@/server/actions/define";

const schema = z.object({ name: z.string().min(2) });

beforeEach(() => {
  state.db = createTestDb();
  state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["super_admin"] }));
  state.revalidated = [];
});

describe("defineAction", () => {
  it("revalidates, runs the after hook and records request metadata after a successful commit", async () => {
    const afterCalls: [string, number][] = [];
    const action = defineAction({
      name: "test.rename",
      schema,
      revalidate: ["/settings/company"],
      handler: ({ audit }, input) => {
        audit({ action: "test.rename", entityType: "thing", entityId: 1, summary: `Renamed to ${input.name}` });
        return input.name.toUpperCase();
      },
      after: async (data, user) => {
        afterCalls.push([data, user.id]);
      },
    });

    const result = await action({ name: "acme" });

    expect(result).toEqual({ ok: true, data: "ACME" });
    expect(state.revalidated).toEqual(["/settings/company"]);
    expect(afterCalls).toEqual([["ACME", state.user!.id]]);
    const row = state.db.select().from(auditLogs).where(eq(auditLogs.action, "test.rename")).get();
    expect(row).toMatchObject({ ip: "203.0.113.9", userAgent: "vitest-agent", actorUserId: state.user!.id });
  });

  it("neither revalidates nor runs the after hook when the handler fails", async () => {
    let afterRan = false;
    const action = defineAction({
      name: "test.fail",
      schema,
      revalidate: ["/settings/company"],
      handler: () => {
        throw new DomainError("NOPE", "Not allowed right now.");
      },
      after: async () => {
        afterRan = true;
      },
    });

    const result = await action({ name: "acme" });

    expect(result).toMatchObject({ ok: false, code: "NOPE" });
    expect(state.revalidated).toEqual([]);
    expect(afterRan).toBe(false);
  });

  it("still reports success when the after hook throws, because the mutation already committed", async () => {
    const action = defineAction({
      name: "test.after-fails",
      schema,
      handler: (_ctx, input) => input.name,
      after: async () => {
        throw new Error("SMTP down");
      },
    });

    await expect(action({ name: "acme" })).resolves.toEqual({ ok: true, data: "acme" });
  });

  it("rejects callers without a session", async () => {
    state.user = null;
    const action = defineAction({ name: "test.anon", schema, handler: () => 1 });
    await expect(action({ name: "acme" })).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });
});
