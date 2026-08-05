import { describe, expect, it } from "vitest";
import { RedisPkceStateStore, type RedisLike } from "./redis-pkce-store.js";

function fake(): { redis: RedisLike; ops: string[]; store: Map<string, string> } {
  const store = new Map<string, string>();
  const ops: string[] = [];
  const redis: RedisLike = {
    async set(k, v, _mode, ttl) {
      ops.push(`SET ${k} EX ${ttl}`);
      store.set(k, v);
      return "OK";
    },
    async get(k) {
      ops.push(`GET ${k}`);
      return store.get(k) ?? null;
    },
    async del(...keys) {
      let n = 0;
      for (const k of keys) {
        ops.push(`DEL ${k}`);
        if (store.delete(k)) n++;
      }
      return n;
    },
  };
  return { redis, ops, store };
}

describe("RedisPkceStateStore", () => {
  it("writes with TTL derived from ms→seconds", async () => {
    const { redis, ops } = fake();
    const s = new RedisPkceStateStore(redis, "mavio:pkce:", 600_000);
    await s.put("st", "verifier");
    expect(ops[0]).toBe("SET mavio:pkce:st EX 600");
  });

  it("take reads then deletes the state", async () => {
    const { redis, ops, store } = fake();
    const s = new RedisPkceStateStore(redis);
    await s.put("st", "v");
    expect(await s.take("st")).toBe("v");
    expect(store.has("mavio:pkce:st")).toBe(false);
    expect(ops.at(-1)).toBe("DEL mavio:pkce:st");
  });

  it("take returns null for unknown state (no DEL wasted)", async () => {
    const { redis, ops } = fake();
    const s = new RedisPkceStateStore(redis);
    expect(await s.take("nope")).toBeNull();
    expect(ops.every((o) => !o.startsWith("DEL"))).toBe(true);
  });

  it("custom prefix threaded through", async () => {
    const { redis, ops } = fake();
    const s = new RedisPkceStateStore(redis, "acme:x:", 60_000);
    await s.put("k", "v");
    expect(ops[0]).toBe("SET acme:x:k EX 60");
  });

  it("clamps sub-second ttl to 1s minimum", async () => {
    const { redis, ops } = fake();
    const s = new RedisPkceStateStore(redis, undefined, 500);
    await s.put("k", "v");
    expect(ops[0]).toContain("EX 1");
  });
});
