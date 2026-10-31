import { randomUUID } from "node:crypto";
import type { Redis } from "@mavio/cache";
import { type StreamableSessionMetadata, type StreamableSessionStore, SESSION_TTL_MS } from "@mavio/transport";

const KEY_PREFIX = "mavio:sess:streamable:";
const TTL_S = Math.ceil(SESSION_TTL_MS / 1000) + 3600; // 25h

export class RedisStreamableSessionStore implements StreamableSessionStore {
  constructor(private readonly redis: Redis) {}

  private key(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`;
  }

  async create(sessionId?: string): Promise<string> {
    const id = sessionId ?? randomUUID();
    const now = Date.now();
    await this.redis.hset(this.key(id), "createdAt", String(now), "lastSeenAt", String(now));
    await this.redis.expire(this.key(id), TTL_S);
    return id;
  }

  async has(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(this.key(sessionId))) === 1;
  }

  async touch(sessionId: string): Promise<boolean> {
    const exists = await this.redis.exists(this.key(sessionId));
    if (!exists) return false;
    await this.redis.hset(this.key(sessionId), "lastSeenAt", String(Date.now()));
    await this.redis.expire(this.key(sessionId), TTL_S);
    return true;
  }

  async get(sessionId: string): Promise<StreamableSessionMetadata | undefined> {
    const data = await this.redis.hgetall(this.key(sessionId));
    if (!data.createdAt || !data.lastSeenAt) return undefined;
    return {
      sessionId,
      createdAt: parseInt(data.createdAt, 10),
      lastSeenAt: parseInt(data.lastSeenAt, 10),
    };
  }

  async delete(sessionId: string): Promise<boolean> {
    const r = await this.redis.del(this.key(sessionId));
    return r > 0;
  }

  async listAll(): Promise<StreamableSessionMetadata[]> {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await this.redis.scan(cursor, "MATCH", `${KEY_PREFIX}*`, "COUNT", "100");
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");

    const results: StreamableSessionMetadata[] = [];
    for (const key of keys) {
      const data = await this.redis.hgetall(key);
      if (!data.createdAt || !data.lastSeenAt) continue;
      const sessionId = key.slice(KEY_PREFIX.length);
      results.push({
        sessionId,
        createdAt: parseInt(data.createdAt, 10),
        lastSeenAt: parseInt(data.lastSeenAt, 10),
      });
    }
    return results;
  }

  async reapExpired(now: number = Date.now()): Promise<number> {
    // Redis TTL auto-expires sessions; manual reap for entries past SESSION_TTL_MS
    const all = await this.listAll();
    let n = 0;
    for (const s of all) {
      if (now - s.lastSeenAt > SESSION_TTL_MS) {
        await this.delete(s.sessionId);
        n++;
      }
    }
    return n;
  }
}
