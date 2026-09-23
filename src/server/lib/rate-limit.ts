export interface RateLimiter {
  /** Records a hit and returns false when the key is over its limit. */
  check(key: string, now?: number): boolean;
  reset(key: string): void;
}

/** In-memory sliding-window limiter. Suitable for the single-process deployment. */
export function createRateLimiter({ windowMs, max }: { windowMs: number; max: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(key, now = Date.now()) {
      const cutoff = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.every((t) => t <= cutoff)) hits.delete(k);
      }
      return true;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
