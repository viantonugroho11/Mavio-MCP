import type { Redis } from "ioredis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Token-bucket rate limiter using Redis atomic INCR + EX.
 * Fixed-window per bucketSeconds.
 */
export class RateLimiter {
  constructor(private readonly redis: Redis) {}

  async check(
    scope: string,
    limit: number,
    bucketSeconds: number,
  ): Promise<RateLimitResult> {
    const bucket = Math.floor(Date.now() / 1000 / bucketSeconds);
    const key = `mavio:rl:${scope}:${bucket}`;
    const pipeline = this.redis.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, bucketSeconds);
    const results = await pipeline.exec();
    const count = Number((results?.[0]?.[1] as number | null) ?? 0);
    const resetAt = (bucket + 1) * bucketSeconds * 1000;
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  }
}
