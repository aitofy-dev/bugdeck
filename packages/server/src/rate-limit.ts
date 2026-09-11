/**
 * A sliding window per user, in memory.
 *
 * In memory on purpose: filing a bug report is a human action at human speed,
 * and the honest ceiling is far below what any one process can serve. A host
 * running several processes gets a limit per process, which is the right
 * trade — a shared limiter would mean a Redis this package does not need.
 *
 * Sliding, not fixed: a fixed window lets someone spend the whole budget in the
 * last second of one window and the whole budget again in the first second of
 * the next.
 */
export interface RateLimiter {
  /** Records the hit and answers whether it was within budget. */
  take(key: string): boolean;
}

export interface RateLimitOptions {
  max: number;
  windowMs: number;
  /** Injectable clock so a test does not have to wait an hour. */
  now?: () => number;
}

/** Above this many keys a sweep runs, so an abandoned key cannot leak forever. */
const SWEEP_AT_KEYS = 1000;

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const now = options.now ?? Date.now;
  const hits = new Map<string, number[]>();

  const sweep = (cutoff: number): void => {
    for (const [key, times] of hits) {
      if (!times.some((time) => time > cutoff)) hits.delete(key);
    }
  };

  return {
    take(key: string): boolean {
      const at = now();
      const cutoff = at - options.windowMs;
      if (hits.size > SWEEP_AT_KEYS) sweep(cutoff);

      const recent = (hits.get(key) ?? []).filter((time) => time > cutoff);
      if (recent.length >= options.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(at);
      hits.set(key, recent);
      return true;
    },
  };
}
