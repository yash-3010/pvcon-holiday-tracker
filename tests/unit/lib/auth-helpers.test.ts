import { describe, expect, it } from "vitest";
import { passwordProblems } from "@/lib/auth/password-policy";
import { isAllowedEmail } from "@/lib/auth/email-domain";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("passwordProblems", () => {
  const policy = { minLength: 10 };
  it("accepts a strong password", () => {
    expect(passwordProblems("Str0ngPassword", policy)).toEqual([]);
  });
  it("lists every unmet rule", () => {
    expect(passwordProblems("short", policy)).toEqual([
      "At least 10 characters",
      "An uppercase letter",
      "A number",
    ]);
    expect(passwordProblems("A".repeat(73) + "a1", policy)).toContain("At most 72 characters");
  });
});

describe("isAllowedEmail", () => {
  it("matches the domain case-insensitively and exactly", () => {
    expect(isAllowedEmail("Yash@PVCON.in", "pvcon.in")).toBe(true);
    expect(isAllowedEmail("x@evil-pvcon.in", "pvcon.in")).toBe(false);
    expect(isAllowedEmail("x@pvcon.in.evil.com", "pvcon.in")).toBe(false);
  });
});

describe("safeRedirectPath", () => {
  it("allows same-origin paths only", () => {
    expect(safeRedirectPath("/settings/users?tab=1")).toBe("/settings/users?tab=1");
    expect(safeRedirectPath("//evil.com")).toBe("/");
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
    expect(safeRedirectPath("https://evil.com")).toBe("/");
    expect(safeRedirectPath(null)).toBe("/");
  });
});
