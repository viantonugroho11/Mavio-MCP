import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { RouterController } from "./router.controller.js";
import { StreamableHttpSessionRegistry } from "./streamable-http.session-registry.js";
import { SseSessionRegistry } from "./sse.registry.js";

function mkReq(headers: Record<string, string> = {}): Request {
  return { headers } as any;
}

function mkRes() {
  const state: any = { status: 200, headers: {}, body: undefined, ended: false, chunks: [] as string[] };
  return {
    _state: state,
    setHeader: vi.fn((k: string, v: string) => { state.headers[k.toLowerCase()] = v; }),
    getHeader: (k: string) => state.headers[k.toLowerCase()],
    status: vi.fn(function (this: any, code: number) { state.status = code; return this; }),
    json: vi.fn(function (this: any, body: unknown) { state.body = body; return this; }),
    end: vi.fn(function (this: any) { state.ended = true; }),
    write: vi.fn(function (this: any, chunk: string) { state.chunks.push(chunk); return true; }),
    flushHeaders: vi.fn(),
  } as any;
}

// Stub RouterService with a passthrough handle().
const routerStub = {
  handle: vi.fn(async (frame: any) => ({ jsonrpc: "2.0", id: frame.id, result: { ok: true } })),
} as any;

const rbacStub = {} as any;

// Stub principal resolver via module mock.
vi.mock("./principal-resolver.js", () => ({
  resolvePrincipalFromRequest: vi.fn(async () => ({ subject: "test", scopes: [], tenant: "t" })),
}));

describe("RouterController Streamable HTTP", () => {
  let streamableReg: StreamableHttpSessionRegistry;
  let sseReg: SseSessionRegistry;
  let controller: RouterController;

  beforeEach(() => {
    streamableReg = new StreamableHttpSessionRegistry();
    sseReg = new SseSessionRegistry();
    controller = new RouterController(routerStub, rbacStub, sseReg, streamableReg);
    routerStub.handle.mockClear();
  });

  it("initialize without session creates one and returns Mcp-Session-Id header", async () => {
    const res = mkRes();
    const frame = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} } as any;
    const result = await controller.handle(frame, mkReq(), res, undefined);
    const sid = (res as any)._state.headers["mcp-session-id"];
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(streamableReg.has(sid)).toBe(true);
    expect(result).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  });

  it("non-initialize without any session returns 400", async () => {
    const res = mkRes();
    const frame = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } as any;
    await controller.handle(frame, mkReq(), res, undefined);
    expect((res as any)._state.status).toBe(400);
  });

  it("valid Mcp-Session-Id + Accept:application/json returns JSON body", async () => {
    const sid = streamableReg.create();
    const res = mkRes();
    const req = mkReq({ "mcp-session-id": sid, accept: "application/json" });
    const frame = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } as any;
    const result = await controller.handle(frame, req, res, undefined);
    expect(result).toEqual({ jsonrpc: "2.0", id: 2, result: { ok: true } });
  });

  it("valid Mcp-Session-Id + Accept:text/event-stream streams SSE and ends", async () => {
    const sid = streamableReg.create();
    const res = mkRes();
    const req = mkReq({ "mcp-session-id": sid, accept: "text/event-stream" });
    const frame = { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} } as any;
    await controller.handle(frame, req, res, undefined);
    const state = (res as any)._state;
    expect(state.headers["content-type"]).toBe("text/event-stream");
    expect(state.chunks[0]).toContain("event: message");
    expect(state.chunks[0]).toContain('"id":3');
    expect(state.ended).toBe(true);
  });

  it("unknown Mcp-Session-Id returns 404", async () => {
    const res = mkRes();
    const req = mkReq({ "mcp-session-id": "bogus" });
    const frame = { jsonrpc: "2.0", id: 4, method: "tools/list", params: {} } as any;
    await controller.handle(frame, req, res, undefined);
    expect((res as any)._state.status).toBe(404);
  });

  it("classic ?sid= path still works", async () => {
    const sid = sseReg.register(mkRes());
    const res = mkRes();
    const frame = { jsonrpc: "2.0", id: 5, method: "tools/list", params: {} } as any;
    await controller.handle(frame, mkReq(), res, sid);
    expect((res as any)._state.status).toBe(202);
  });
});
