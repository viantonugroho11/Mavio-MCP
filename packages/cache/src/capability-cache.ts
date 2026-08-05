import type { Redis } from "ioredis";
import type { ServerCapabilities, ServerDescriptor } from "@mavio/core";

export interface CachedServer {
  descriptor: ServerDescriptor;
  capabilities: ServerCapabilities;
}

export interface CapabilityCacheOptions {
  ttlSeconds?: number;
  /** Region tag; cache keys are namespaced so multiple regions can share a Redis. */
  region?: string;
}

export class CapabilityCache {
  private readonly ttlSeconds: number;
  private readonly region: string;
  private readonly prefix: string;
  private readonly serversKey: string;

  constructor(private readonly redis: Redis, opts: CapabilityCacheOptions | number = {}) {
    if (typeof opts === "number") {
      this.ttlSeconds = opts;
      this.region = "default";
    } else {
      this.ttlSeconds = opts.ttlSeconds ?? 300;
      this.region = opts.region ?? "default";
    }
    this.prefix = `mavio:cap:${this.region}:`;
    this.serversKey = `mavio:servers:${this.region}:list`;
  }

  private key(serverId: string): string {
    return `${this.prefix}${serverId}`;
  }

  async getServerList(): Promise<ServerDescriptor[] | null> {
    const raw = await this.redis.get(this.serversKey);
    return raw ? (JSON.parse(raw) as ServerDescriptor[]) : null;
  }

  async setServerList(list: ServerDescriptor[]): Promise<void> {
    await this.redis.set(this.serversKey, JSON.stringify(list), "EX", this.ttlSeconds);
  }

  async getCapabilities(serverId: string): Promise<ServerCapabilities | null> {
    const raw = await this.redis.get(this.key(serverId));
    return raw ? (JSON.parse(raw) as ServerCapabilities) : null;
  }

  async setCapabilities(serverId: string, caps: ServerCapabilities): Promise<void> {
    await this.redis.set(this.key(serverId), JSON.stringify(caps), "EX", this.ttlSeconds);
  }

  async invalidate(serverId?: string): Promise<void> {
    if (serverId) {
      await this.redis.del(this.key(serverId));
    }
    await this.redis.del(this.serversKey);
  }

  async invalidateAll(): Promise<void> {
    const keys = await this.redis.keys(`${this.prefix}*`);
    if (keys.length > 0) await this.redis.del(...keys);
    await this.redis.del(this.serversKey);
  }
}
