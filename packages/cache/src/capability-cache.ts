import type { Redis } from "ioredis";
import type { ServerCapabilities, ServerDescriptor } from "@mavio/core";

const PREFIX = "mavio:cap:";
const SERVERS_KEY = "mavio:servers:list";

export interface CachedServer {
  descriptor: ServerDescriptor;
  capabilities: ServerCapabilities;
}

export class CapabilityCache {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds = 300,
  ) {}

  private key(serverId: string): string {
    return `${PREFIX}${serverId}`;
  }

  async getServerList(): Promise<ServerDescriptor[] | null> {
    const raw = await this.redis.get(SERVERS_KEY);
    return raw ? (JSON.parse(raw) as ServerDescriptor[]) : null;
  }

  async setServerList(list: ServerDescriptor[]): Promise<void> {
    await this.redis.set(SERVERS_KEY, JSON.stringify(list), "EX", this.ttlSeconds);
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
    await this.redis.del(SERVERS_KEY);
  }

  async invalidateAll(): Promise<void> {
    const keys = await this.redis.keys(`${PREFIX}*`);
    if (keys.length > 0) await this.redis.del(...keys);
    await this.redis.del(SERVERS_KEY);
  }
}
