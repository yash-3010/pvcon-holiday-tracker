import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { executeAction } from "@/server/actions/execute";
import type { DB } from "@/server/db/client";
import { auditLogs, notifications } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { notify } from "@/server/modules/notifications/service";
import { createTestDb } from "../helpers/db";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const schema = z.object({ name: z.string().min(2) });
let db: DB;
let employee: SessionUser;
let admin: SessionUser;
beforeEach(() => {
  db = createTestDb();
  employee = sessionUserFor(db, insertUser(db, { roles: ["employee"] }));
  admin = sessionUserFor(db, insertUser(db, { roles: ["super_admin"] }));
});

describe("executeAction", () => {
  it("requires a user", async () => {
    const res = await executeAction(db, null, { name: "t", schema, handler: () => 1 }, { name: "ok" });
    expect(res).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("returns field errors for invalid input", async () => {
    const res = await executeAction(db, admin, { name: "t", schema, handler: () => 1 }, { name: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("VALIDATION");
      expect(res.fieldErrors?.name?.length).toBeGreaterThan(0);
    }
  });

  it("enforces string and function permissions", async () => {
    const denied = await executeAction(
      db, employee, { name: "t", schema, permission: "settings.manage", handler: () => 1 }, { name: "ok" },
    );
    expect(denied).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const byInput = await executeAction(
      db, employee,
      { name: "t", schema, permission: (u, input) => input.name === "self" || can(u, "settings.manage"), handler: () => 1 },
      { name: "self" },
    );
    expect(byInput).toEqual({ ok: true, data: 1 });
  });

  it("runs the handler in a transaction and audits with request metadata", async () => {
    const res = await executeAction(
      db, admin,
      {
        name: "test.run",
        schema,
        permission: "settings.manage",
        handler: ({ tx, user, audit }, input) => {
          notify(tx, { userId: user.id, type: "t", title: input.name });
          audit({ action: "test.run", entityType: "test", entityId: 1, summary: `Ran ${input.name}` });
          return { greeting: `hi ${input.name}` };
        },
      },
      { name: "there" },
      { ip: "1.2.3.4", userAgent: "vitest" },
    );
    expect(res).toEqual({ ok: true, data: { greeting: "hi there" } });
    const log = db.select().from(auditLogs).all();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorUserId: admin.id, ip: "1.2.3.4", userAgent: "vitest", entityId: "1" });
  });

  it("rolls back and maps DomainError", async () => {
    const res = await executeAction(
      db, admin,
      {
        name: "t",
        schema,
        handler: ({ tx, user, audit }) => {
          notify(tx, { userId: user.id, type: "t", title: "should roll back" });
          audit({ action: "t", entityType: "t", summary: "rolled back" });
          throw new DomainError("NOPE", "Not allowed right now.");
        },
      },
      { name: "ok" },
    );
    expect(res).toMatchObject({ ok: false, code: "NOPE", error: "Not allowed right now." });
    expect(db.select().from(notifications).all()).toHaveLength(0);
    expect(db.select().from(auditLogs).all()).toHaveLength(0);
  });

  it("maps unexpected errors and async handlers to INTERNAL", async () => {
    const boom = await executeAction(db, admin, { name: "t", schema, handler: () => { throw new Error("boom"); } }, { name: "ok" });
    expect(boom).toMatchObject({ ok: false, code: "INTERNAL" });
    const asyncHandler = await executeAction(
      db, admin,
      { name: "t", schema, handler: (async () => 1) as unknown as () => number },
      { name: "ok" },
    );
    expect(asyncHandler).toMatchObject({ ok: false, code: "INTERNAL" });
  });

  it("passes the result of async prepare to the handler and maps prepare DomainErrors", async () => {
    const res = await executeAction(
      db, admin,
      { name: "t", schema, prepare: async (input) => input.name.toUpperCase(), handler: (_ctx, _input, prepared) => prepared },
      { name: "ok" },
    );
    expect(res).toEqual({ ok: true, data: "OK" });
    const failed = await executeAction(
      db, admin,
      { name: "t", schema, prepare: async () => { throw new DomainError("PREP", "Bad"); }, handler: () => 1 },
      { name: "ok" },
    );
    expect(failed).toMatchObject({ ok: false, code: "PREP" });
  });
});
