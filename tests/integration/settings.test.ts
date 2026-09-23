import { beforeEach, describe, expect, it } from "vitest";
import { companySettings } from "@/server/db/schema";
import type { DB } from "@/server/db/client";
import { getSetting, patchSetting, updateSetting } from "@/server/modules/settings/service";
import { localeSettingsSchema } from "@/lib/validation/settings";
import { createTestDb } from "../helpers/db";

let db: DB;
beforeEach(() => {
  db = createTestDb();
});

describe("settings service", () => {
  it("returns defaults when nothing is stored", () => {
    expect(getSetting(db, "locale")).toEqual({ timezone: "Asia/Kolkata", currency: "INR", fiscalYearStartMonth: 4 });
    expect(getSetting(db, "security").lockoutAttempts).toBe(5);
  });

  it("patches, persists and reports before/after", () => {
    const { before, after } = patchSetting(db, "security", { lockoutAttempts: 7 }, null);
    expect(before.lockoutAttempts).toBe(5);
    expect(after).toEqual({ lockoutAttempts: 7, lockoutMinutes: 15, passwordMinLength: 10 });
    expect(getSetting(db, "security").lockoutAttempts).toBe(7);
  });

  it("merges defaults into stored values that predate new keys", () => {
    db.insert(companySettings).values({ key: "compOff", value: { enabled: false } }).run();
    const value = getSetting(db, "compOff");
    expect(value.enabled).toBe(false);
    expect(value.expiryDays).toBe(90);
  });

  it("falls back to defaults when the stored value is invalid", () => {
    db.insert(companySettings).values({ key: "security", value: { lockoutAttempts: 0 } }).run();
    expect(getSetting(db, "security").lockoutAttempts).toBe(5);
  });

  it("rejects invalid updates", () => {
    expect(() => updateSetting(db, "security", { lockoutAttempts: 1, lockoutMinutes: 15, passwordMinLength: 10 }, null)).toThrow();
  });

  it("validates time zones", () => {
    expect(localeSettingsSchema.safeParse({ timezone: "Mars/Olympus", currency: "INR", fiscalYearStartMonth: 4 }).success).toBe(false);
  });
});
