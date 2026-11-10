/**
 * Minimal per-key sliding-window limiter.
 *
 * PROTOTYPE LIMITATION: state lives in this server instance's memory. It
 * resets on restart/redeploy and is not shared between instances (e.g.
 * multiple serverless workers), so it is a best-effort brake against
 * accidental spamming — not a real quota. Use a shared store (Redis,
 * Postgres) plus Google Cloud quota limits for production.
 */

export interface LimiterOptions {
  limit: number;
  windowMs: number;
  /** Upper bound on tracked keys; idle keys are pruned beyond this. */
  maxKeys?: number;
}

export type LimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxKeys: number;

  constructor(private readonly options: LimiterOptions) {
    this.maxKeys = options.maxKeys ?? 10_000;
  }

  get size(): number {
    return this.hits.size;
  }

  /** Records a hit for `key` if allowed. Rejected hits are not recorded. */
  hit(key: string, now: number): LimitResult {
    const { limit, windowMs } = this.options;
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      const retryAfterMs = windowMs - (now - recent[0]);
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    recent.push(now);
    this.hits.delete(key); // re-insert to keep Map order ~ recency
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.prune(now);
    return { ok: true };
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.options.windowMs)) this.hits.delete(key);
    }
    // Still too many active keys: drop the oldest-inserted.
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(key);
    }
  }
}
