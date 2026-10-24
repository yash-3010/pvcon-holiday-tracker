import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/public-paths";

describe("isPublicPath", () => {
  it("allows auth pages, health, cron, verification, static brand assets and the app manifest", () => {
    for (const p of [
      "/login", "/forgot-password", "/reset-password/abc", "/api/health", "/api/auth/session", "/api/cron/system:cleanup", "/verify/ABC123",
      "/brand/pvcon-logo-only.png", "/manifest.webmanifest", "/icons/icon-192.png",
    ]) {
      expect(isPublicPath(p)).toBe(true);
    }
  });
  it("protects everything else", () => {
    for (const p of ["/", "/settings/users", "/loginx", "/api/files/1", "/notifications"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
});
