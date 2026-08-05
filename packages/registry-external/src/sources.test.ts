import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { ServerDescriptor } from "@mavio/core";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { EtcdSource } from "./etcd.js";
import { ConsulSource } from "./consul.js";

const desc: ServerDescriptor = {
  id: "s1",
  workspaceId: "w",
  projectId: "p",
  name: "s1",
  sourceType: "native",
  transport: { type: "stdio", command: "echo" },
};

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString("base64");

let previous: Dispatcher;
let agent: MockAgent;

beforeEach(() => {
  previous = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  await agent.close();
  setGlobalDispatcher(previous);
});

describe("EtcdSource", () => {
  it("decodes kvs from range response", async () => {
    agent
      .get("http://etcd:2379")
      .intercept({ path: "/v3/kv/range", method: "POST" })
      .reply(200, { kvs: [{ key: b64("k"), value: b64(desc) }] });
    const src = new EtcdSource({ endpoint: "http://etcd:2379" });
    expect(await src.list()).toEqual([desc]);
  });

  it("throws on non-2xx", async () => {
    agent
      .get("http://etcd:2379")
      .intercept({ path: "/v3/kv/range", method: "POST" })
      .reply(503, {});
    const src = new EtcdSource({ endpoint: "http://etcd:2379" });
    await expect(src.list()).rejects.toThrow(/etcd range 503/);
  });

  it("skips malformed values", async () => {
    agent
      .get("http://etcd:2379")
      .intercept({ path: "/v3/kv/range", method: "POST" })
      .reply(200, {
        kvs: [
          { key: b64("a"), value: "!!!not-json!!!" },
          { key: b64("b"), value: b64(desc) },
        ],
      });
    const src = new EtcdSource({ endpoint: "http://etcd:2379" });
    expect(await src.list()).toEqual([desc]);
  });
});

describe("ConsulSource", () => {
  it("returns [] on 404", async () => {
    agent
      .get("http://consul:8500")
      .intercept({ path: /^\/v1\/kv\/.*/, method: "GET" })
      .reply(404, "");
    const src = new ConsulSource({ endpoint: "http://consul:8500" });
    expect(await src.list()).toEqual([]);
  });

  it("decodes recursive KV entries", async () => {
    agent
      .get("http://consul:8500")
      .intercept({ path: /^\/v1\/kv\/.*/, method: "GET" })
      .reply(200, [
        { Key: "mavio/servers/s1", Value: b64(desc) },
        { Key: "mavio/servers/nil", Value: null },
      ]);
    const src = new ConsulSource({ endpoint: "http://consul:8500" });
    expect(await src.list()).toEqual([desc]);
  });
});
