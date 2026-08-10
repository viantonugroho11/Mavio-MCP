import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
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

describe("StreamableHttpController", () => {
  let registry: StreamableHttpSessionRegistry;
  let controller: StreamableHttpController;

  beforeEach(() => {
    registry = new StreamableHttpSessionRegistry();
    controller = new StreamableHttpController(registry);
  });

  describe("GET /mcp", () => {
    it("returns 404 when Mcp-Session-Id absent", async () => {
      const res = mkRes();
      await controller.stream(mkReq(), res, undefined);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.end).toHaveBeenCalled();
    });

    it("returns 404 when session unknown", async () => {
      const res = mkRes();
      await controller.stream(mkReq(), res, "not-a-session");
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("attaches SSE stream on valid session", async () => {
      const sid = registry.create();
      const res = mkRes();
      const req = mkReq();
      await controller.stream(req, res, sid);
      expect(res.setHeader).toHaveBeenCalledWith("content-type", "text/event-stream");
      expect(res.setHeader).toHaveBeenCalledWith("cache-control", "no-cache, no-transform");
      expect(res.setHeader).toHaveBeenCalledWith("connection", "keep-alive");
    });

    it("detaches stream on request close", async () => {
      const sid = registry.create();
      const res = mkRes();
      const req = mkReq();
      await controller.stream(req, res, sid);
      registry.pushNotification(sid, { jsonrpc: "2.0", method: "x" } as any);
      expect(res.write).toHaveBeenCalled();
      req._closeHandlers.forEach((cb) => cb());
      const writesAfter = (res.write as any).mock.calls.length;
      registry.pushNotification(sid, { jsonrpc: "2.0", method: "y" } as any);
      expect((res.write as any).mock.calls.length).toBe(writesAfter);
    });
  });

  describe("DELETE /mcp", () => {
    it("returns 404 when session absent", () => {
      const res = mkRes();
      controller.terminate(res, undefined);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("returns 200 and removes session", () => {
      const sid = registry.create();
      const res = mkRes();
      controller.terminate(res, sid);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(registry.has(sid)).toBe(false);
    });
  });
});
