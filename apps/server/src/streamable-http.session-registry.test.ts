import { describe, it, expect, vi } from "vitest";
import type { Response } from "express";
import { SESSION_TTL_MS } from "@mavio/transport";
import {
  StreamableHttpSessionRegistry,
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
  it("create returns a UUID and has() is true", async () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = await r.create();
    expect(sid).toMatch(/^[0-9a-f-]{36}$/);
    expect(await r.has(sid)).toBe(true);
  });

  it("delete removes session", async () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = await r.create();
    r.delete(sid);
    expect(await r.has(sid)).toBe(false);
  });

  it("pushNotification buffers when no push stream attached", async () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = await r.create();
    const ok = await r.pushNotification(sid, { jsonrpc: "2.0", method: "n", params: {} } as any);
    expect(ok).toBe(true);
  });

  it("attachPushStream drains buffered notifications", async () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = await r.create();
    await r.pushNotification(sid, { jsonrpc: "2.0", method: "a" } as any);
    await r.pushNotification(sid, { jsonrpc: "2.0", method: "b" } as any);
    const res = mkRes();
    await r.attachPushStream(sid, res);
    expect(res._chunks.length).toBe(2);
    expect(res._chunks[0]).toContain("event: message");
    expect(res._chunks[0]).toContain('"method":"a"');
  });

  it("pushNotification writes directly when stream attached", async () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = await r.create();
    const res = mkRes();
    await r.attachPushStream(sid, res);
    await r.pushNotification(sid, { jsonrpc: "2.0", method: "live" } as any);
    expect(res._chunks[0]).toContain('"method":"live"');
  });

  it("buffer caps at BUFFER_LIMIT", async () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = await r.create();
    for (let i = 0; i < BUFFER_LIMIT + 20; i++) {
      await r.pushNotification(sid, { jsonrpc: "2.0", method: `m${i}` } as any);
    }
    const res = mkRes();
    await r.attachPushStream(sid, res);
    expect(res._chunks.length).toBe(BUFFER_LIMIT);
  });

  it("reapExpired removes sessions older than TTL", async () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = await r.create();
    const future = Date.now() + SESSION_TTL_MS + 1;
    const reaped = await r.reapExpired(future);
    expect(reaped).toBe(1);
    expect(await r.has(sid)).toBe(false);
  });

  it("touch is fire-and-forget (no return value)", async () => {
    const r = new StreamableHttpSessionRegistry();
    const result = r.touch("nope");
    expect(result).toBeUndefined();
  });

  it("pushNotification bumps lastSeenAt, extending TTL for push-only sessions", async () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = await r.create();

    const pushedAt = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(pushedAt);
    await r.pushNotification(sid, { jsonrpc: "2.0", method: "keepalive" } as any);
    vi.restoreAllMocks();

    // Not yet expired relative to the push time.
    expect(await r.reapExpired(pushedAt + SESSION_TTL_MS)).toBe(0);
    expect(await r.has(sid)).toBe(true);

    // Expired once past TTL from the push time.
    expect(await r.reapExpired(pushedAt + SESSION_TTL_MS + 1)).toBe(1);
    expect(await r.has(sid)).toBe(false);
  });

  it("detachPushStream nulls stream but keeps session", async () => {
    const r = new StreamableHttpSessionRegistry();
    const sid = await r.create();
    const res = mkRes();
    await r.attachPushStream(sid, res);
    r.detachPushStream(sid);
    expect(await r.has(sid)).toBe(true);
    const ok = await r.pushNotification(sid, { jsonrpc: "2.0", method: "buffered" } as any);
    expect(ok).toBe(true);
  });
});
