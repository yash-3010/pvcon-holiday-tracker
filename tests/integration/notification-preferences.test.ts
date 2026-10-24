import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, notifications, users, type UserRow } from "@/server/db/schema";
import type { EmailMessage } from "@/server/lib/email";
import { emailOutbox } from "@/server/modules/notifications/email";
import { notify, setEmailMode } from "@/server/modules/notifications/service";
import { createTestDb } from "../helpers/db";
import { insertUser, sessionUserFor } from "../helpers/fixtures";

// Only the Next.js runtime boundary and the mail transport are replaced.
const state = vi.hoisted(() => ({
  db: undefined as unknown as DB, user: null as SessionUser | null, smtp: true, fail: false, sent: [] as EmailMessage[],
}));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/server/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/lib/email")>()),
  isEmailConfigured: () => state.smtp,
  sendEmail: async (message: EmailMessage) => {
    if (state.fail) throw new Error("550 relay denied");
    state.sent.push(message);
    return { sent: true };
  },
}));

import { setEmailModeAction } from "@/app/(app)/notifications/actions";
import { sendTestEmailAction } from "@/app/(app)/settings/email/actions";

let asha: UserRow;
const statusOf = (title: string) => state.db.select().from(notifications).all().find((n) => n.title === title)!.emailStatus;

beforeEach(() => {
  state.db = createTestDb();
  state.smtp = true;
  state.fail = false;
  state.sent = [];
  asha = insertUser(state.db, { name: "Asha" });
  state.user = sessionUserFor(state.db, asha);
});

describe("email mode", () => {
  it("moves unsent email copies along with the user's choice", () => {
    notify(state.db, { userId: asha.id, type: "test", title: "One" });
    expect(statusOf("One")).toBe("pending");
    setEmailMode(state.db, asha.id, "digest");
    expect(statusOf("One")).toBe("digest");
    notify(state.db, { userId: asha.id, type: "test", title: "Two" });
    expect(statusOf("Two")).toBe("digest");
    setEmailMode(state.db, asha.id, "instant");
    expect([statusOf("One"), statusOf("Two")]).toEqual(["pending", "pending"]);
    expect(setEmailMode(state.db, asha.id, "off")).toEqual({ before: "instant", after: "off" });
    notify(state.db, { userId: asha.id, type: "test", title: "Three" });
    expect([statusOf("One"), statusOf("Two"), statusOf("Three")]).toEqual(["skipped", "skipped", "skipped"]);
  });

  it("is saved for the caller only, and audited", async () => {
    const other = insertUser(state.db);
    await expect(setEmailModeAction({ mode: "digest" })).resolves.toEqual({ ok: true, data: { mode: "digest" } });
    const modes = state.db.select({ id: users.id, mode: users.emailMode }).from(users).all();
    expect(modes.find((u) => u.id === asha.id)!.mode).toBe("digest");
    expect(modes.find((u) => u.id === other.id)!.mode).toBe("instant");
    expect(state.db.select().from(auditLogs).where(eq(auditLogs.action, "user.email_mode")).get()).toMatchObject({
      actorUserId: asha.id, diff: { emailMode: { from: "instant", to: "digest" } },
    });
    await expect(setEmailModeAction({ mode: "weekly" as never })).resolves.toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("outbox and test email", () => {
  it("counts waiting, sent and failed email copies", () => {
    const now = new Date();
    const old = new Date(now.getTime() - 2 * 86_400_000).toISOString();
    const row = (emailStatus: "pending" | "digest" | "sent" | "skipped", extra: Partial<typeof notifications.$inferInsert> = {}) =>
      state.db.insert(notifications).values({ userId: asha.id, type: "t", title: "x", emailStatus, ...extra }).run();
    row("pending");
    row("pending", { emailAttempts: 1 });
    row("digest");
    row("sent", { emailedAt: now.toISOString() });
    row("sent", { emailedAt: old });
    row("skipped", { emailAttempts: 3 });
    row("skipped", { emailAttempts: 3, createdAt: old });
    row("skipped");
    expect(emailOutbox(state.db, now)).toEqual({ pending: 2, digest: 1, sentLastDay: 1, failedLastDay: 1 });
  });

  it("sends a test email to the administrator, for settings managers only", async () => {
    await expect(sendTestEmailAction({})).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    state.user = sessionUserFor(state.db, insertUser(state.db, { roles: ["super_admin"], email: "admin@pvcon.in", name: "Admin" }));
    await expect(sendTestEmailAction({})).resolves.toEqual({ ok: true, data: { to: "admin@pvcon.in" } });
    expect(state.sent.map((m) => [m.to, m.subject])).toEqual([["admin@pvcon.in", "PVCON People test email"]]);
    expect(state.db.select().from(auditLogs).where(eq(auditLogs.action, "settings.email_test")).all()).toHaveLength(1);

    state.fail = true;
    await expect(sendTestEmailAction({})).resolves.toMatchObject({ ok: false, code: "SEND_FAILED", error: expect.stringContaining("550 relay denied") });
    state.smtp = false;
    await expect(sendTestEmailAction({})).resolves.toMatchObject({ ok: false, code: "SMTP_NOT_CONFIGURED" });
  });
});
