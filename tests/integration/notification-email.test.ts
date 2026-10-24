import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailMessage } from "@/server/lib/email";
import type { DB } from "@/server/db/client";
import { notifications, users } from "@/server/db/schema";
import { deliverDigests, deliverNotificationEmails } from "@/server/modules/notifications/email";
import { notify, notifyMany } from "@/server/modules/notifications/service";
import { createTestDb } from "../helpers/db";
import { insertUser } from "../helpers/fixtures";

const state = { smtp: true, fail: 0, sent: [] as EmailMessage[] };
vi.mock("@/server/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/lib/email")>();
  return {
    ...actual,
    isEmailConfigured: () => state.smtp,
    sendEmail: async (message: EmailMessage) => {
      if (state.fail > 0) {
        state.fail -= 1;
        throw new Error("SMTP down");
      }
      state.sent.push(message);
      return { sent: true };
    },
  };
});

let db: DB;
// Rows get the real creation time, so "now" is the real clock.
const NOW = new Date();
const opts = { now: NOW, appUrl: "https://people.pvcon.in" };
const statuses = () => db.select({ title: notifications.title, status: notifications.emailStatus }).from(notifications).all().map((n) => [n.title, n.status]);

beforeEach(() => {
  db = createTestDb();
  state.smtp = true;
  state.fail = 0;
  state.sent = [];
});

describe("notification email", () => {
  it("follows each user's email mode, and payslips email themselves", () => {
    const instant = insertUser(db, { email: "instant@pvcon.in" });
    const digest = insertUser(db, { email: "digest@pvcon.in" });
    const off = insertUser(db, { email: "off@pvcon.in" });
    const disabled = insertUser(db, { email: "gone@pvcon.in", status: "disabled" });
    db.update(users).set({ emailMode: "digest" }).where(eq(users.id, digest.id)).run();
    db.update(users).set({ emailMode: "off" }).where(eq(users.id, off.id)).run();
    notifyMany(db, [instant.id, digest.id, off.id, disabled.id], { type: "leave.approved", title: "Approved" });
    notify(db, { userId: instant.id, type: "payslip.released", title: "Payslip" });
    expect(statuses()).toEqual([["Approved", "pending"], ["Approved", "digest"], ["Approved", "skipped"], ["Approved", "skipped"], ["Payslip", "skipped"]]);
  });

  it("sends each pending email once, with a link to the app", async () => {
    const user = insertUser(db, { email: "asha@pvcon.in" });
    notify(db, { userId: user.id, type: "leave.approved", title: "Your leave was approved", body: "2 Nov", link: "/me/leave" });
    const [a, b] = await Promise.all([deliverNotificationEmails(db, opts), deliverNotificationEmails(db, opts)]);
    expect(a + b).toBe(1);
    expect(state.sent.map((m) => [m.to, m.subject])).toEqual([["asha@pvcon.in", "Your leave was approved"]]);
    expect(state.sent[0]!.text).toContain("https://people.pvcon.in/me/leave");
    expect(db.select().from(notifications).get()).toMatchObject({ emailStatus: "sent", emailedAt: NOW.toISOString() });
    expect(await deliverNotificationEmails(db, opts)).toBe(0);
  });

  it("retries failures, gives up after three attempts, and skips when SMTP is missing or the row is old", async () => {
    const user = insertUser(db, { email: "asha@pvcon.in" });
    notify(db, { userId: user.id, type: "leave.approved", title: "Flaky" });
    state.fail = 3;
    for (let i = 0; i < 3; i++) await deliverNotificationEmails(db, opts);
    expect(db.select().from(notifications).get()).toMatchObject({ emailStatus: "skipped", emailAttempts: 3 });

    notify(db, { userId: user.id, type: "leave.approved", title: "Old" });
    db.update(notifications).set({ createdAt: new Date(NOW.getTime() - 4 * 86_400_000).toISOString() }).where(eq(notifications.title, "Old")).run();
    notify(db, { userId: user.id, type: "leave.approved", title: "No SMTP" });
    state.smtp = false;
    expect(await deliverNotificationEmails(db, opts)).toBe(0);
    expect(statuses().slice(1)).toEqual([["Old", "skipped"], ["No SMTP", "skipped"]]);
    expect(state.sent).toEqual([]);
  });

  it("sends a daily digest per user", async () => {
    const user = insertUser(db, { email: "digest@pvcon.in" });
    db.update(users).set({ emailMode: "digest" }).where(eq(users.id, user.id)).run();
    notify(db, { userId: user.id, type: "leave.submitted", title: "Ravi asked for leave", link: "/approvals" });
    notify(db, { userId: user.id, type: "claim.submitted", title: "Kiran submitted a claim" });
    expect(await deliverNotificationEmails(db, opts)).toBe(0);
    expect(await deliverDigests(db, opts)).toBe(1);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.subject).toBe("2 updates from PVCON People");
    expect(state.sent[0]!.text).toContain("Ravi asked for leave");
    expect(state.sent[0]!.text).toContain("Kiran submitted a claim");
    expect(statuses()).toEqual([["Ravi asked for leave", "sent"], ["Kiran submitted a claim", "sent"]]);
    expect(await deliverDigests(db, opts)).toBe(0);
  });
});
