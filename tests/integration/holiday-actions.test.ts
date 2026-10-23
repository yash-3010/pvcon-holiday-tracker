import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { getYearConfig, listHolidays } from "@/server/modules/holidays/service";
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

import {
  copyHolidaysAction, createHolidayAction, deleteHolidayAction, importHolidaysAction, setYearConfigAction, updateHolidayAction,
} from "@/app/(app)/leave/holidays/actions";

const actions = () => state.db.select().from(auditLogs).all().map((a) => a.action);

beforeEach(() => {
  state.db = createTestDb();
  state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["hr_admin"] }));
});

describe("holiday actions", () => {
  it("manages a year's calendar with audit entries", async () => {
    const created = await createHolidayAction({ date: "2026-11-08", name: "Diwali", type: "optional" });
    expect(created).toMatchObject({ ok: true });
    const id = (created as { data: { id: number } }).data.id;
    await expect(updateHolidayAction({ id, date: "2026-11-09", name: "Diwali", type: "optional" })).resolves.toMatchObject({ ok: true });
    await expect(setYearConfigAction({ year: 2026, optionalAllowed: 2 })).resolves.toMatchObject({ ok: true });
    await expect(copyHolidaysAction({ fromYear: 2026, toYear: 2027 })).resolves.toEqual({ ok: true, data: { created: 1, skipped: 0 } });
    await expect(deleteHolidayAction({ id })).resolves.toMatchObject({ ok: true });
    expect(getYearConfig(state.db, 2027).optionalAllowed).toBe(2);
    expect(actions()).toEqual(["holiday.create", "holiday.update", "holiday_year.update", "holiday.copy", "holiday.delete"]);
  });

  it("imports all rows or none, auditing only a successful import", async () => {
    await expect(importHolidaysAction({ csv: "date,name\n2026-01-26,Republic Day\n2026-13-01,Bad\n" })).resolves.toMatchObject({
      ok: true, data: { created: 0, errors: [{ row: 2 }] },
    });
    expect(listHolidays(state.db, 2026)).toEqual([]);
    await expect(importHolidaysAction({ csv: "date,name\n2026-01-26,Republic Day\n" })).resolves.toMatchObject({ ok: true, data: { created: 1 } });
    expect(actions()).toEqual(["holiday.import"]);
  });

  it("needs holiday.manage", async () => {
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["employee"] }));
    await expect(createHolidayAction({ date: "2026-01-26", name: "Republic Day", type: "fixed" })).resolves.toMatchObject({ code: "FORBIDDEN" });
  });
});
