import { describe, it, expect, vi } from "vitest";
import type { Response } from "express";
import {
  StreamableHttpSessionRegistry,
  SESSION_TTL_MS,
  BUFFER_LIMIT,
} from "./streamable-http.session-registry.js";

function mkRes(): Response & { _chunks: string[]; ended: boolean } {
  const chunks: string[] = [];
  return {
    _chunks: chunks,
    ended: false,
    write: vi.fn(function (this: any, chunk: string) {
      chunks.push(chunk);
      return true;
    }),
    end: vi.fn(function (this: any) {
      this.ended = true;
    }),
  } as any;
}

describe("StreamableHttpSessionRegistry", () => {
  it("create returns a UUID and has() is true", () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = r.create();
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.has(sid)).toBe(true);
  });

  it("delete removes session", () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = r.create();
    r.delete(sid);
    expect(r.has(sid)).toBe(false);
  });

  it("pushNotification buffers when no push stream attached", () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = r.create();
    const ok = r.pushNotification(sid, { jsonrpc: "2.0", method: "n", params: {} } as any);
    expect(ok).toBe(true);
  });

  it("attachPushStream drains buffered notifications", () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = r.create();
    r.pushNotification(sid, { jsonrpc: "2.0", method: "a" } as any);
    r.pushNotification(sid, { jsonrpc: "2.0", method: "b" } as any);
    const res = mkRes();
    r.attachPushStream(sid, res);
    expect(res._chunks.length).toBe(2);
    expect(res._chunks[0]).toContain("event: message");
    expect(res._chunks[0]).toContain('"method":"a"');
  });

  it("pushNotification writes directly when stream attached", () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = r.create();
    const res = mkRes();
    r.attachPushStream(sid, res);
    r.pushNotification(sid, { jsonrpc: "2.0", method: "live" } as any);
    expect(res._chunks[0]).toContain('"method":"live"');
  });

  it("buffer caps at BUFFER_LIMIT", () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = r.create();
    for (let i = 0; i < BUFFER_LIMIT + 20; i++) {
      r.pushNotification(sid, { jsonrpc: "2.0", method: `m${i}` } as any);
    }
    const res = mkRes();
    r.attachPushStream(sid, res);
    expect(res._chunks.length).toBe(BUFFER_LIMIT);
  });

  it("reapExpired removes sessions older than TTL", () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = r.create();
    const future = Date.now() + SESSION_TTL_MS + 1;
    const reaped = r.reapExpired(future);
    expect(reaped).toBe(1);
    expect(r.has(sid)).toBe(false);
  });

  it("touch returns false for absent session", () => {
    const r = new StreamableHttpSessionRegistry();
    expect(r.touch("nope")).toBe(false);
  });

  it("pushNotification bumps lastSeenAt, extending TTL for push-only sessions", () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = r.create();

    const pushedAt = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(pushedAt);
    r.pushNotification(sid, { jsonrpc: "2.0", method: "keepalive" } as any);
    vi.restoreAllMocks();

    // Not yet expired relative to the push time.
    expect(r.reapExpired(pushedAt + SESSION_TTL_MS)).toBe(0);
    expect(r.has(sid)).toBe(true);

    // Expired once past TTL from the push time.
    expect(r.reapExpired(pushedAt + SESSION_TTL_MS + 1)).toBe(1);
    expect(r.has(sid)).toBe(false);
  });

  it("detachPushStream nulls stream but keeps session", () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = r.create();
    const res = mkRes();
    r.attachPushStream(sid, res);
    r.detachPushStream(sid);
    expect(r.has(sid)).toBe(true);
    const ok = r.pushNotification(sid, { jsonrpc: "2.0", method: "buffered" } as any);
    expect(ok).toBe(true);
  });
});
