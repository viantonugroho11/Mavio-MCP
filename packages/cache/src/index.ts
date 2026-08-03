import Redis, { type RedisOptions } from "ioredis";

export function createRedis(url: string, opts: RedisOptions = {}): Redis {
  return new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3, ...opts });
}

export { CapabilityCache } from "./capability-cache.js";
export { InvalidationBus, type InvalidationEvent } from "./pubsub.js";
export { RateLimiter } from "./rate-limit.js";
export type { Redis };
