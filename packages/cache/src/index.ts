import { Redis as IORedis, type RedisOptions } from "ioredis";

export function createRedis(url: string, opts: RedisOptions = {}): IORedis {
  return new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: 3, ...opts });
}

type RedisClient = IORedis;

export { CapabilityCache } from "./capability-cache.js";
export { InvalidationBus, type InvalidationEvent } from "./pubsub.js";
export { RateLimiter } from "./rate-limit.js";
export type { RedisClient as Redis };
