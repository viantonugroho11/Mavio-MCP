import { describe, expect, it } from "vitest";
import type { Redis } from "ioredis";
import { CapabilityCache } from "./capability-cache.js";

function makeFakeRedis() {
  const store = new Map<string, string>();
  const calls: Array<{ op: string; key: string }> = [];
  const redis = {
    async get(k: string) {
      calls.push({ op: "get", key: k });
      return store.get(k) ?? null;
    },
    async set(k: string, v: string) {
      calls.push({ op: "set", key: k });
      store.set(k, v);
      return "OK";
    },
    async del(...keys: string[]) {
      for (const k of keys) {
        calls.push({ op: "del", key: k });
        store.delete(k);
      }
      return keys.length;
    },
    async keys(pattern: string) {
      calls.push({ op: "keys", key: pattern });
      const re = new RegExp("^" + pattern.replace("*", ".*") + "$");
      return [...store.keys()].filter((k) => re.test(k));
    },
  } as unknown as Redis;
  return { redis, store, calls };
}

describe("CapabilityCache regional namespace", () => {
  it("uses default region prefix when unset", async () => {
    const { redis, calls } = makeFakeRedis();
    const c = new CapabilityCache(redis);
    await c.setCapabilities("s1", { tools: [] });
    expect(calls.some((c) => c.key === "mavio:cap:default:s1")).toBe(true);
  });

  it("scopes keys by region", async () => {
    const { redis, calls } = makeFakeRedis();
    const c = new CapabilityCache(redis, { region: "eu-west" });
    await c.setCapabilities("s1", { tools: [] });
    await c.setServerList([]);
    const keys = calls.filter((c) => c.op === "set").map((c) => c.key);
    expect(keys).toContain("mavio:cap:eu-west:s1");
    expect(keys).toContain("mavio:servers:eu-west:list");
  });

  it("isolates two regions on the same Redis", async () => {
    const { redis } = makeFakeRedis();
    const eu = new CapabilityCache(redis, { region: "eu" });
    const us = new CapabilityCache(redis, { region: "us" });
    await eu.setCapabilities("s1", { tools: [{ name: "a", inputSchema: {} }] });
    await us.setCapabilities("s1", { tools: [{ name: "b", inputSchema: {} }] });
    expect((await eu.getCapabilities("s1"))?.tools?.[0]?.name).toBe("a");
    expect((await us.getCapabilities("s1"))?.tools?.[0]?.name).toBe("b");
  });

  it("legacy numeric ttl arg still works", async () => {
    const { redis } = makeFakeRedis();
    const c = new CapabilityCache(redis, 60);
    await c.setCapabilities("s", { tools: [] });
    expect(await c.getCapabilities("s")).toEqual({ tools: [] });
  });
});
