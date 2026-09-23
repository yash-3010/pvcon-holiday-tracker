import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/server/lib/rate-limit";

describe("createRateLimiter", () => {
  it("allows up to max hits per window per key", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 2 });
    expect(limiter.check("ip:1", 0)).toBe(true);
    expect(limiter.check("ip:1", 100)).toBe(true);
    expect(limiter.check("ip:1", 200)).toBe(false);
    expect(limiter.check("ip:2", 200)).toBe(true);
  });

  it("frees capacity once hits leave the window", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.check("k", 0)).toBe(true);
    expect(limiter.check("k", 999)).toBe(false);
    expect(limiter.check("k", 1001)).toBe(true);
  });

  it("can be reset", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    limiter.check("k", 0);
    limiter.reset("k");
    expect(limiter.check("k", 1)).toBe(true);
  });
});
