import { describe, it, expect, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { vi } from "vitest";
import { StreamableHttpController } from "./streamable-http.controller.js";
import { StreamableHttpSessionRegistry } from "./streamable-http.session-registry.js";

function mkReq(): Request & { _closeHandlers: Array<() => void> } {
  const handlers: Array<() => void> = [];
  return {
    _closeHandlers: handlers,
    on: vi.fn((evt: string, cb: () => void) => {
      if (evt === "close") handlers.push(cb);
    }),
  } as any;
}

function mkRes() {
  return {
    setHeader: vi.fn(),
    status: vi.fn(function (this: any) { return this; }),
    end: vi.fn(),
    write: vi.fn(),
    flushHeaders: vi.fn(),
  } as any;
}

describe("Streamable HTTP e2e (registry + controller only)", () => {
  let registry: StreamableHttpSessionRegistry;
  let controller: StreamableHttpController;

  beforeEach(() => {
    registry = new StreamableHttpSessionRegistry();
    controller = new StreamableHttpController(registry);
  });

  it("GET /mcp without Mcp-Session-Id → 404", async () => {
    const res = mkRes();
    await controller.stream(mkReq(), res, undefined);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
  });

  it("DELETE /mcp without Mcp-Session-Id → 404", async () => {
    const res = mkRes();
    controller.terminate(res, undefined);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
  });

  it("DELETE /mcp with valid session → 200", async () => {
    const sid = registry.create();
    expect(registry.has(sid)).toBe(true);
    
    const res = mkRes();
    controller.terminate(res, sid);
    
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.end).toHaveBeenCalled();
    expect(registry.has(sid)).toBe(false);
  });
});
