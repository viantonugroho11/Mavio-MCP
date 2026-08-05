import { randomUUID } from "node:crypto";
import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import {
  CapabilityCache,
  InvalidationBus,
  createRedis,
  type Redis,
} from "@mavio/cache";
import type { MavioConfig } from "@mavio/config";
import { MAVIO_CONFIG } from "./config.module.js";

export const REDIS = Symbol("REDIS");
export const REDIS_SUB = Symbol("REDIS_SUB");
export const CAPABILITY_CACHE = Symbol("CAPABILITY_CACHE");
export const INVALIDATION_BUS = Symbol("INVALIDATION_BUS");
export const NODE_ID = Symbol("NODE_ID");
export const REGION = Symbol("REGION");
export function currentRegion(): string {
  return process.env.MAVIO_REGION ?? "default";
}

@Global()
@Module({
  providers: [
    { provide: NODE_ID, useValue: `node-${randomUUID().slice(0, 8)}` },
    { provide: REGION, useValue: currentRegion() },
    {
      provide: REDIS,
      inject: [MAVIO_CONFIG],
      useFactory: (config: MavioConfig): Redis => createRedis(config.cache.url),
    },
    {
      provide: REDIS_SUB,
      inject: [MAVIO_CONFIG],
      useFactory: (config: MavioConfig): Redis => createRedis(config.cache.url),
    },
    {
      provide: CAPABILITY_CACHE,
      inject: [REDIS, REGION],
      useFactory: (redis: Redis, region: string): CapabilityCache =>
        new CapabilityCache(redis, { region }),
    },
    {
      provide: INVALIDATION_BUS,
      inject: [REDIS, REDIS_SUB, NODE_ID],
      useFactory: (pub: Redis, sub: Redis, nodeId: string): InvalidationBus =>
        new InvalidationBus(pub, sub, nodeId),
    },
  ],
  exports: [REDIS, CAPABILITY_CACHE, INVALIDATION_BUS, NODE_ID, REGION],
})
export class CacheModule implements OnModuleDestroy {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(REDIS_SUB) private readonly sub: Redis,
    @Inject(INVALIDATION_BUS) private readonly bus: InvalidationBus,
    @Inject(NODE_ID) private readonly nodeId: string,
  ) {
    console.log(`[cache] node=${nodeId} redis wired`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.bus.close();
    await this.redis.quit();
    await this.sub.quit();
  }
}
