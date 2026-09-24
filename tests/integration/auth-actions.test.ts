import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { CredentialsSignin } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { DB } from "@/server/db/client";
import { auditLogs, passwordResetTokens, users, type UserRow } from "@/server/db/schema";
import type { EmailMessage } from "@/server/lib/email";
import { createPasswordResetToken, getUserById } from "@/server/modules/users/service";
import { createTestDb } from "../helpers/db";
import { insertUser, sessionUserFor, TEST_PASSWORD } from "../helpers/fixtures";

// Replaced: Auth.js sign-in, the Next request/navigation runtime and SMTP delivery. The DB and services are real.
const state = vi.hoisted(() => ({
  db: undefined as unknown as DB,
  user: null as SessionUser | null,
  ip: "198.51.100.1",
  smtp: true,
  sent: [] as EmailMessage[],
  signInCalls: [] as unknown[][],
  signInImpl: (async () => undefined) as (...args: unknown[]) => Promise<unknown>,
}));
vi.mock("@/server/db", () => ({
  get db() {
    return state.db;
  },
}));
vi.mock("@/auth", () => ({
  signIn: (...args: unknown[]) => {
    state.signInCalls.push(args);
    return state.signInImpl(...args);
  },
  signOut: async () => undefined,
}));
vi.mock("@/server/auth/session", () => ({ getCurrentUser: async () => state.user }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": state.ip, "user-agent": "vitest-agent" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/server/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/lib/email")>();
  return {
    ...actual,
    isEmailConfigured: () => state.smtp,
    sendEmail: async (message: EmailMessage) => {
      state.sent.push(message);
      return { sent: true };
    },
  };
});

import {
  changePasswordAction,
  forgotPasswordAction,
  loginAction,
  resetPasswordAction,
} from "@/app/(auth)/actions";

const NEW_PASSWORD = "Fresh-Passw0rd";
let ipSeq = 0;
let employee: UserRow;

function form(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}
const auditActions = () => state.db.select().from(auditLogs).all().map((r) => r.action);

beforeEach(() => {
  state.db = createTestDb();
  state.user = null;
  state.ip = `198.51.100.${++ipSeq}`;
  state.smtp = true;
  state.sent = [];
  state.signInCalls = [];
  state.signInImpl = async () => undefined;
  employee = insertUser(state.db, { email: "asha@pvcon.in", name: "Asha Rao" });
});

describe("loginAction", () => {
  it("maps credential failures to friendly messages and keeps the typed email", async () => {
    class Locked extends CredentialsSignin {
      code = "locked";
    }
    state.signInImpl = async () => {
      throw new Locked();
    };
    await expect(loginAction({}, form({ email: "asha@pvcon.in", password: "x" }))).resolves.toEqual({
      email: "asha@pvcon.in",
      error: "Too many failed attempts. Your account is locked for a few minutes.",
    });

    state.signInImpl = async () => {
      throw new CredentialsSignin();
    };
    await expect(loginAction({}, form({ email: "asha@pvcon.in", password: "x" }))).resolves.toMatchObject({
      error: "Incorrect email or password.",
    });
  });

  it("only forwards same-origin paths as the post-login destination", async () => {
    await loginAction({}, form({ email: "asha@pvcon.in", password: "x", next: "//evil.example/steal" }));
    await loginAction({}, form({ email: "asha@pvcon.in", password: "x", next: "/settings/users?tab=1" }));
    expect(state.signInCalls.map((call) => (call[1] as { redirectTo: string }).redirectTo)).toEqual([
      "/",
      "/settings/users?tab=1",
    ]);
  });
});

describe("forgotPasswordAction", () => {
  const GENERIC = "If an account exists for that email, a reset link is on its way. It expires in 30 minutes.";

  it("emails a reset link to an active user and answers generically", async () => {
    const result = await forgotPasswordAction({}, form({ email: " Asha@PVCON.in " }));

    expect(result).toEqual({ message: GENERIC });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.to).toBe("asha@pvcon.in");
    expect(state.sent[0]!.text).toMatch(/http:\/\/localhost:3000\/reset-password\/\S+/);
    expect(state.db.select().from(passwordResetTokens).all()).toHaveLength(1);
    expect(auditActions()).toContain("auth.reset_requested");
  });

  it("gives the same answer for unknown and off-domain emails without sending anything", async () => {
    insertUser(state.db, { email: "asha@gmail.com" }); // an off-domain account must never receive a link
    await expect(forgotPasswordAction({}, form({ email: "nobody@pvcon.in" }))).resolves.toEqual({ message: GENERIC });
    await expect(forgotPasswordAction({}, form({ email: "asha@gmail.com" }))).resolves.toEqual({ message: GENERIC });
    expect(state.sent).toEqual([]);
    expect(state.db.select().from(passwordResetTokens).all()).toEqual([]);
  });

  it("points the user to an administrator when email delivery is not configured", async () => {
    state.smtp = false;
    const result = await forgotPasswordAction({}, form({ email: "asha@pvcon.in" }));
    expect(result.message).toMatch(/administrator/);
    expect(state.db.select().from(passwordResetTokens).all()).toEqual([]);
  });

  it("rate-limits repeated requests from one address", async () => {
    for (let i = 0; i < 5; i++) {
      await expect(forgotPasswordAction({}, form({ email: "nobody@pvcon.in" }))).resolves.toEqual({ message: GENERIC });
    }
    await expect(forgotPasswordAction({}, form({ email: "asha@pvcon.in" }))).resolves.toEqual({
      error: "Too many requests. Please try again later.",
    });
    expect(state.sent).toEqual([]);
  });
});

describe("resetPasswordAction", () => {
  it("rejects a mismatched confirmation without consuming the link", async () => {
    const { token } = createPasswordResetToken(state.db, "asha@pvcon.in")!;
    const result = await resetPasswordAction(
      {},
      form({ token, newPassword: NEW_PASSWORD, confirmPassword: "Other-Passw0rd" }),
    );
    expect(result).toEqual({ fieldErrors: { confirmPassword: ["Passwords do not match."] } });
    expect(state.db.select().from(passwordResetTokens).get()!.usedAt).toBeNull();
  });

  it("sets the new password, audits it and sends the user to sign in", async () => {
    const { token } = createPasswordResetToken(state.db, "asha@pvcon.in")!;
    await expect(
      resetPasswordAction({}, form({ token, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })),
    ).rejects.toThrow("REDIRECT /login?reset=1");
    expect(bcrypt.compareSync(NEW_PASSWORD, getUserById(state.db, employee.id)!.passwordHash)).toBe(true);
    expect(auditActions()).toContain("auth.password_reset");
  });

  it("reports an invalid link", async () => {
    await expect(
      resetPasswordAction({}, form({ token: "not-a-real-token", newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })),
    ).resolves.toEqual({ error: "This reset link is invalid or has expired." });
  });
});

describe("changePasswordAction", () => {
  it("sends anonymous callers to the login page", async () => {
    await expect(changePasswordAction({}, form({}))).rejects.toThrow("REDIRECT /login");
  });

  it("returns field errors for a mismatched confirmation or a wrong current password", async () => {
    state.user = sessionUserFor(state.db, employee);
    await expect(
      changePasswordAction({}, form({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: "nope" })),
    ).resolves.toEqual({ fieldErrors: { confirmPassword: ["Passwords do not match."] } });
    await expect(
      changePasswordAction({}, form({ currentPassword: "Wrong-Passw0rd", newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD })),
    ).resolves.toMatchObject({ fieldErrors: { currentPassword: ["Incorrect"] } });
    expect(state.signInCalls).toEqual([]);
  });

  it("changes the password, clears the forced-change flag and signs this browser back in", async () => {
    state.db.update(users).set({ mustChangePassword: true }).where(eq(users.id, employee.id)).run();
    state.user = sessionUserFor(state.db, employee);

    await changePasswordAction(
      {},
      form({ currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD }),
    );

    const stored = getUserById(state.db, employee.id)!;
    expect(stored.mustChangePassword).toBe(false);
    expect(bcrypt.compareSync(NEW_PASSWORD, stored.passwordHash)).toBe(true);
    expect(state.signInCalls).toEqual([["credentials", { email: "asha@pvcon.in", password: NEW_PASSWORD, redirectTo: "/" }]]);
    expect(auditActions()).toContain("user.password_changed");
  });
});
