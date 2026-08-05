import type { PkceStateStore } from "./pkce.js";

/**
 * Minimal Redis interface used by RedisPkceStateStore. Matches the ioredis
 * client that `@mavio/cache` exposes without importing from the cache
 * package (keeps this pkg's dependency graph lean).
 */
export interface RedisLike {
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
}

/**
 * Redis-backed PKCE state store for multi-node deployments where the consent
 * redirect may land on a different replica than the one that issued the
 * authorize URL. Keys expire automatically after ttlMs, so stale states never
 * pile up.
 */
export class RedisPkceStateStore implements PkceStateStore {
  private readonly ttlSec: number;

  constructor(
    private readonly redis: RedisLike,
    private readonly prefix = "mavio:pkce:",
    ttlMs = 600_000,
  ) {
    this.ttlSec = Math.max(1, Math.floor(ttlMs / 1000));
  }

  async put(state: string, verifier: string): Promise<void> {
    await this.redis.set(this.prefix + state, verifier, "EX", this.ttlSec);
  }

  async take(state: string): Promise<string | null> {
    const key = this.prefix + state;
    const value = await this.redis.get(key);
    if (!value) return null;
    await this.redis.del(key);
    return value;
  }
}
