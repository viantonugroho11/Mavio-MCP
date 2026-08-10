import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, type Dispatcher } from "undici";
import { StreamableHttpTransport } from "./streamable-http.js";

let originalDispatcher: Dispatcher;
let agent: MockAgent;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  await agent.close();
  setGlobalDispatcher(originalDispatcher);
});

describe("StreamableHttpTransport", () => {
  it("initialize returns Mcp-Session-Id and JSON body", async () => {
    const pool = agent.get("http://example.com");
    pool.intercept({ path: "/mcp", method: "POST" }).reply(
      200,
      { jsonrpc: "2.0", id: 1, result: { serverInfo: {} } },
      { headers: { "mcp-session-id": "sess-abc", "content-type": "application/json" } },
    );
    const t = new StreamableHttpTransport();
    const s = await t.open({ type: "streamable-http", url: "http://example.com/mcp" });
    const resp = await s.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} } as any);
    expect(resp).toEqual({ jsonrpc: "2.0", id: 1, result: { serverInfo: {} } });
  });

  it("subsequent send parses JSON response", async () => {
    const pool = agent.get("http://example.com");
    pool.intercept({ path: "/mcp", method: "POST" }).reply(
      200,
      { jsonrpc: "2.0", id: 1, result: { serverInfo: {} } },
      { headers: { "mcp-session-id": "sess-abc", "content-type": "application/json" } },
    );
    pool.intercept({
      path: "/mcp",
      method: "POST",
      headers: (h: any) => h["mcp-session-id"] === "sess-abc",
    }).reply(
      200,
      { jsonrpc: "2.0", id: 2, result: { tools: [] } },
      { headers: { "content-type": "application/json" } },
    );
    const t = new StreamableHttpTransport();
    const s = await t.open({ type: "streamable-http", url: "http://example.com/mcp" });
    await s.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} } as any);
    const resp = await s.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } as any);
    expect(resp).toEqual({ jsonrpc: "2.0", id: 2, result: { tools: [] } });
  });

  it("subsequent send parses SSE response frame", async () => {
    const pool = agent.get("http://example.com");
    pool.intercept({ path: "/mcp", method: "POST" }).reply(
      200,
      { jsonrpc: "2.0", id: 1, result: {} },
      { headers: { "mcp-session-id": "sess-xyz", "content-type": "application/json" } },
    );
    const sseBody = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { hi: true } })}\n\n`;
    pool.intercept({ path: "/mcp", method: "POST" }).reply(
      200,
      sseBody,
      { headers: { "content-type": "text/event-stream" } },
    );
    const t = new StreamableHttpTransport();
    const s = await t.open({ type: "streamable-http", url: "http://example.com/mcp" });
    await s.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} } as any);
    const resp = await s.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } as any);
    expect(resp).toEqual({ jsonrpc: "2.0", id: 2, result: { hi: true } });
  });

  it("close sends DELETE with Mcp-Session-Id", async () => {
    const pool = agent.get("http://example.com");
    pool.intercept({ path: "/mcp", method: "POST" }).reply(
      200,
      { jsonrpc: "2.0", id: 1, result: {} },
      { headers: { "mcp-session-id": "sess-del", "content-type": "application/json" } },
    );
    let deleteSeen = false;
    pool.intercept({
      path: "/mcp",
      method: "DELETE",
      headers: (h: any) => {
        deleteSeen = h["mcp-session-id"] === "sess-del";
        return deleteSeen;
      },
    }).reply(200, "");
    const t = new StreamableHttpTransport();
    const s = await t.open({ type: "streamable-http", url: "http://example.com/mcp" });
    await s.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} } as any);
    await s.close();
    expect(deleteSeen).toBe(true);
  });
});
