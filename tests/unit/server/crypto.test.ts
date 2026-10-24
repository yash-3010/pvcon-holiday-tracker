import { afterEach, describe, expect, it } from "vitest";
import { decrypt, encrypt, mask, randomToken, safeEqual, sha256Hex } from "@/server/lib/crypto";

const KEY = process.env.DATA_ENCRYPTION_KEY;
afterEach(() => {
  process.env.DATA_ENCRYPTION_KEY = KEY;
});

describe("crypto", () => {
  it("round-trips field encryption with a random IV", () => {
    const a = encrypt("50100123456789");
    const b = encrypt("50100123456789");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(decrypt(a)).toBe("50100123456789");
  });

  it("detects tampering", () => {
    const payload = encrypt("secret");
    const parts = payload.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  it("requires a 32-byte key", () => {
    process.env.DATA_ENCRYPTION_KEY = "";
    expect(() => encrypt("x")).toThrow(/DATA_ENCRYPTION_KEY/);
    process.env.DATA_ENCRYPTION_KEY = Buffer.from("short").toString("base64");
    expect(() => encrypt("x")).toThrow(/32 bytes/);
  });

  it("masks all but the last four characters without leaking length", () => {
    expect(mask("123456789012")).toBe("XXXX9012");
    expect(mask("12")).toBe("XXXX");
    expect(mask("")).toBe("");
  });

  it("hashes, generates tokens and compares safely", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(safeEqual("Bearer abc", "Bearer abc")).toBe(true);
    expect(safeEqual("Bearer abc", "Bearer abcd")).toBe(false);
  });
});
