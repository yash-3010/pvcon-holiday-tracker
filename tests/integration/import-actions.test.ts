import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, employees } from "@/server/db/schema";
import { createTestDb } from "../helpers/db";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

const state = vi.hoisted(() => ({ db: undefined as unknown as DB, user: null as SessionUser | null }));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { commitImportAction, previewImportAction } from "@/app/(app)/org/import/actions";

const csv = "first_name,last_name,work_email,date_of_joining\nAsha,Rao,asha@pvcon.in,2026-10-01\nRavi,Menon,ravi@pvcon.in,2026-10-05\n";

beforeEach(() => {
  state.db = createTestDb();
  state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
});

describe("import actions", () => {
  it("previews for employee.import holders without saving anything", async () => {
    await expect(previewImportAction({ csv })).resolves.toMatchObject({ ok: true, data: { valid: 2, invalid: 0, fileErrors: [] } });
    expect(state.db.select().from(employees).all()).toEqual([]);
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["employee"] }));
    await expect(previewImportAction({ csv })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });

  it("commits every row in one go and audits it", async () => {
    await expect(commitImportAction({ csv })).resolves.toEqual({ ok: true, data: { created: 2, codes: ["PV0001", "PV0002"] } });
    expect(state.db.select().from(auditLogs).all().map((a) => a.action)).toEqual(["employee.import"]);
  });

  it("imports nothing when a row is invalid", async () => {
    await expect(commitImportAction({ csv: `${csv}Kiran,Das,asha@pvcon.in,2026-10-05\n` })).resolves.toMatchObject({
      ok: false, code: "IMPORT_INVALID",
    });
    expect(state.db.select().from(employees).all()).toEqual([]);
  });
});
