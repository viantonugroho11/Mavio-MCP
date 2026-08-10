# Streamable HTTP Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement MCP 2025-03 Streamable HTTP transport (stateful mode B) as parallel endpoint alongside existing classic HTTP+SSE, plus client-side transport in `@mavio/transport`.

**Architecture:** New `StreamableHttpController` handles `GET /mcp` (open SSE push stream) and `DELETE /mcp` (terminate). Existing `RouterController` extended to detect `Mcp-Session-Id` header on POST and either register new session (initialize) or dispatch with optional SSE reply based on `Accept` header. Session state keyed by server-generated UUID in a new `StreamableHttpSessionRegistry`. Classic `SseController` + `SseSessionRegistry` remain untouched.

**Tech Stack:** NestJS 10 (Express platform), TypeScript ES modules, Vitest, `undici` for client HTTP.

## Global Constraints

- Backward-compat: `GET /mcp/sse`, `POST /mcp?sid=<uuid>` remain functional and unchanged.
- Session TTL: 24 hours, cleanup interval 1 hour.
- `Mcp-Session-Id` values: UUID v4, server-generated at `initialize`.
- Notification buffer per session: max 100 frames before GET drain.
- All new files ES module TypeScript (`type: "module"`), imports use `.js` suffix.
- Existing `RouterService` and `SseSessionRegistry` must not be modified.
- Test runner: `vitest run` (from `apps/server/` or `packages/transport/`).
- Build command guard: prepend `GVM_ROOT=$HOME/.gvm` to any `pnpm`/`git` command that hits a shell hook.

---

### Task 1: Add `StreamableHttpTransportDescriptor` to core

**Files:**
- Modify: `packages/core/src/index.ts` (add interface, add to union)
- Test: `packages/core/src/index.test.ts` (create if absent, else append)

**Interfaces:**
- Consumes: nothing
- Produces: `StreamableHttpTransportDescriptor { type: "streamable-http"; url: string; headers?: Record<string,string>; auth?: {type:"bearer";secretRef:string}|{type:"none"} }`; added as member of `TransportDescriptor` union.

- [ ] **Step 1: Write failing test**

Append or create `packages/core/src/index.test.ts`:

```typescript
import { describe, it, expectTypeOf } from "vitest";
import type { TransportDescriptor, StreamableHttpTransportDescriptor } from "./index.js";

describe("StreamableHttpTransportDescriptor", () => {
  it("is a member of TransportDescriptor union", () => {
    const d: StreamableHttpTransportDescriptor = {
      type: "streamable-http",
      url: "http://x/mcp",
    };
    const t: TransportDescriptor = d;
    expectTypeOf(t).toMatchTypeOf<TransportDescriptor>();
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
cd packages/core && GVM_ROOT=$HOME/.gvm pnpm exec vitest run src/index.test.ts
```
Expected: FAIL with "no exported member StreamableHttpTransportDescriptor".

- [ ] **Step 3: Add interface + union entry**

In `packages/core/src/index.ts`, add near the other transport descriptors:

```typescript
export interface StreamableHttpTransportDescriptor {
  type: "streamable-http";
  url: string;
  headers?: Record<string, string>;
  auth?: { type: "bearer"; secretRef: string } | { type: "none" };
}
```

Add `| StreamableHttpTransportDescriptor` to the `TransportDescriptor` union.

- [ ] **Step 4: Run test to verify pass**

```bash
cd packages/core && GVM_ROOT=$HOME/.gvm pnpm exec vitest run src/index.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
GVM_ROOT=$HOME/.gvm git add packages/core/src/index.ts packages/core/src/index.test.ts
GVM_ROOT=$HOME/.gvm git commit -m "feat(core): add StreamableHttpTransportDescriptor"
```

---

### Task 2: Server-side `StreamableHttpSessionRegistry`

**Files:**
- Create: `apps/server/src/streamable-http.session-registry.ts`
- Test: `apps/server/src/streamable-http.session-registry.test.ts`

**Interfaces:**
- Consumes: `MCPFrame` from `@mavio/core`; `Response` from `express`.
- Produces:
  ```typescript
  @Injectable()
  export class StreamableHttpSessionRegistry {
    create(): string;                              // returns new sessionId
    has(sessionId: string): boolean;
    touch(sessionId: string): boolean;             // returns false if expired/absent
    attachPushStream(sessionId: string, res: Response): boolean;
    detachPushStream(sessionId: string): void;
    pushNotification(sessionId: string, frame: MCPFrame): boolean;  // buffers if no stream
    delete(sessionId: string): void;
    reapExpired(now?: number): number;             // returns count reaped
  }
  export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
  export const BUFFER_LIMIT = 100;
  ```

- [ ] **Step 1: Write failing test file**

Create `apps/server/src/streamable-http.session-registry.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify fail**

```bash
cd apps/server && GVM_ROOT=$HOME/.gvm pnpm exec vitest run src/streamable-http.session-registry.test.ts
```
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement registry**

Create `apps/server/src/streamable-http.session-registry.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import type { MCPFrame } from "@mavio/core";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const BUFFER_LIMIT = 100;

interface Session {
  sessionId: string;
  createdAt: number;
  lastSeenAt: number;
  pushStream: Response | null;
  pendingNotifications: string[];
}

@Injectable()
export class StreamableHttpSessionRegistry {
  private readonly sessions = new Map<string, Session>();

  create(): string {
    const sessionId = randomUUID();
    const now = Date.now();
    this.sessions.set(sessionId, {
      sessionId,
      createdAt: now,
      lastSeenAt: now,
      pushStream: null,
      pendingNotifications: [],
    });
    return sessionId;
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  touch(sessionId: string): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.lastSeenAt = Date.now();
    return true;
  }

  attachPushStream(sessionId: string, res: Response): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    s.pushStream = res;
    for (const chunk of s.pendingNotifications) {
      try {
        res.write(chunk);
      } catch {
        s.pushStream = null;
        return false;
      }
    }
    s.pendingNotifications = [];
    return true;
  }

  detachPushStream(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) s.pushStream = null;
  }

  pushNotification(sessionId: string, frame: MCPFrame): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    const chunk = `event: message\ndata: ${JSON.stringify(frame)}\n\n`;
    if (s.pushStream) {
      try {
        s.pushStream.write(chunk);
        return true;
      } catch {
        s.pushStream = null;
      }
    }
    if (s.pendingNotifications.length >= BUFFER_LIMIT) {
      s.pendingNotifications.shift();
    }
    s.pendingNotifications.push(chunk);
    return true;
  }

  delete(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s?.pushStream) {
      try {
        s.pushStream.end();
      } catch {
        /* ignore */
      }
    }
    this.sessions.delete(sessionId);
  }

  reapExpired(now: number = Date.now()): number {
    let n = 0;
    for (const [sid, s] of this.sessions) {
      if (now - s.lastSeenAt > SESSION_TTL_MS) {
        this.delete(sid);
        n++;
      }
    }
    return n;
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd apps/server && GVM_ROOT=$HOME/.gvm pnpm exec vitest run src/streamable-http.session-registry.test.ts
```
Expected: PASS all 9 tests.

- [ ] **Step 5: Commit**

```bash
GVM_ROOT=$HOME/.gvm git add apps/server/src/streamable-http.session-registry.ts apps/server/src/streamable-http.session-registry.test.ts
GVM_ROOT=$HOME/.gvm git commit -m "feat(server): StreamableHttpSessionRegistry with buffered notifications"
```

---

### Task 3: `StreamableHttpController` — GET + DELETE endpoints

**Files:**
- Create: `apps/server/src/streamable-http.controller.ts`
- Test: `apps/server/src/streamable-http.controller.test.ts`

**Interfaces:**
- Consumes: `StreamableHttpSessionRegistry` (Task 2).
- Produces: `@Controller("mcp")` with:
  - `@Get() stream(@Req, @Res, @Headers("mcp-session-id"))` — opens SSE push stream
  - `@Delete() terminate(@Res, @Headers("mcp-session-id"))` — closes session

Note: NestJS Nest routes both handlers on `/mcp`, differentiated by HTTP method. Existing `RouterController` handles POST — no collision.

- [ ] **Step 1: Write failing test**

Create `apps/server/src/streamable-http.controller.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify fail**

```bash
cd apps/server && GVM_ROOT=$HOME/.gvm pnpm exec vitest run src/streamable-http.controller.test.ts
```
Expected: FAIL module-not-found.

- [ ] **Step 3: Implement controller**

Create `apps/server/src/streamable-http.controller.ts`:

```typescript
import { Controller, Delete, Get, Headers, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { StreamableHttpSessionRegistry } from "./streamable-http.session-registry.js";

@Controller("mcp")
export class StreamableHttpController {
  constructor(private readonly registry: StreamableHttpSessionRegistry) {}

  @Get()
  async stream(
    @Req() req: Request,
    @Res() res: Response,
    @Headers("mcp-session-id") sessionId: string | undefined,
  ): Promise<void> {
    if (!sessionId || !this.registry.has(sessionId)) {
      res.status(404).end();
      return;
    }
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();

    this.registry.touch(sessionId);
    this.registry.attachPushStream(sessionId, res);

    const ping = setInterval(() => {
      try {
        res.write(`: keep-alive\n\n`);
      } catch {
        /* stream closed */
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(ping);
      this.registry.detachPushStream(sessionId);
    });
  }

  @Delete()
  terminate(
    @Res() res: Response,
    @Headers("mcp-session-id") sessionId: string | undefined,
  ): void {
    if (!sessionId || !this.registry.has(sessionId)) {
      res.status(404).end();
      return;
    }
    this.registry.delete(sessionId);
    res.status(200).end();
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd apps/server && GVM_ROOT=$HOME/.gvm pnpm exec vitest run src/streamable-http.controller.test.ts
```
Expected: PASS all 6 tests.

- [ ] **Step 5: Commit**

```bash
GVM_ROOT=$HOME/.gvm git add apps/server/src/streamable-http.controller.ts apps/server/src/streamable-http.controller.test.ts
GVM_ROOT=$HOME/.gvm git commit -m "feat(server): StreamableHttpController for GET/DELETE /mcp"
```

---

### Task 4: Extend `RouterController` for Streamable HTTP POST

**Files:**
- Modify: `apps/server/src/router.controller.ts`
- Test: `apps/server/src/router.controller.test.ts` (create)

**Interfaces:**
- Consumes: `StreamableHttpSessionRegistry` (Task 2), `RouterService` (unchanged), `SseSessionRegistry` (unchanged).
- Produces: same route `POST /mcp`, but with three branches:
  1. `Mcp-Session-Id` header absent AND frame.method === "initialize" → create session, respond with header + JSON body
  2. `Mcp-Session-Id` header present AND session valid → dispatch, reply SSE if `Accept: text/event-stream` else JSON
  3. `?sid=` classic behavior preserved (unchanged code path)
  4. Frame.method !== "initialize" AND no session AND no `?sid` → 400

- [ ] **Step 1: Write failing test**

Create `apps/server/src/router.controller.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify fail**

```bash
cd apps/server && GVM_ROOT=$HOME/.gvm pnpm exec vitest run src/router.controller.test.ts
```
Expected: FAIL — `RouterController` constructor arity mismatch (4th arg not accepted) OR type errors.

- [ ] **Step 3: Modify `router.controller.ts`**

Replace file body with:

```typescript
import { Body, Controller, Inject, Post, Query, Req, Res, UseInterceptors } from "@nestjs/common";
import type { Request, Response } from "express";
import type { MCPFrame } from "@mavio/core";
import { RbacRepository } from "@mavio/registry";
import { RouterService } from "./router.service.js";
import { RateLimitInterceptor } from "./rate-limit.interceptor.js";
import { RBAC_REPO } from "./rbac.module.js";
import { resolvePrincipalFromRequest } from "./principal-resolver.js";
import { SseSessionRegistry } from "./sse.registry.js";
import { StreamableHttpSessionRegistry } from "./streamable-http.session-registry.js";

@Controller("mcp")
@UseInterceptors(RateLimitInterceptor)
export class RouterController {
  constructor(
    private readonly router: RouterService,
    @Inject(RBAC_REPO) private readonly rbac: RbacRepository,
    private readonly sseRegistry: SseSessionRegistry,
    private readonly streamable: StreamableHttpSessionRegistry,
  ) {}

  @Post()
  async handle(
    @Body() frame: MCPFrame,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query("sid") sid?: string,
  ): Promise<MCPFrame | void> {
    const principal = await resolvePrincipalFromRequest(req, this.rbac);
    const streamableSid = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
    const accept = (req.headers["accept"] as string | undefined) ?? "";

    // Streamable HTTP: session header present
    if (streamableSid) {
      if (!this.streamable.has(streamableSid)) {
        res.status(404).end();
        return;
      }
      this.streamable.touch(streamableSid);
      const response = await this.router.handle(frame, principal);
      if (accept.includes("text/event-stream")) {
        res.setHeader("content-type", "text/event-stream");
        res.setHeader("cache-control", "no-cache, no-transform");
        res.setHeader("connection", "keep-alive");
        res.flushHeaders?.();
        res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
        res.end();
        return;
      }
      return response;
    }

    // Streamable HTTP: initialize (creates session)
    if (!sid && frame.method === "initialize") {
      const response = await this.router.handle(frame, principal);
      const newSid = this.streamable.create();
      res.setHeader("mcp-session-id", newSid);
      return response;
    }

    // Classic SSE POST with ?sid=
    if (sid && this.sseRegistry.has(sid)) {
      const response = await this.router.handle(frame, principal);
      const delivered = this.sseRegistry.send(sid, response);
      if (delivered) {
        res.status(202).end();
        return;
      }
      return response;
    }

    // No session, non-initialize: reject
    if (!sid) {
      res.status(400).end();
      return;
    }

    // Fallback: plain POST /mcp (legacy stateless), pass through
    return this.router.handle(frame, principal);
  }
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
cd apps/server && GVM_ROOT=$HOME/.gvm pnpm exec vitest run src/router.controller.test.ts
```
Expected: PASS all 6 tests.

- [ ] **Step 5: Commit**

```bash
GVM_ROOT=$HOME/.gvm git add apps/server/src/router.controller.ts apps/server/src/router.controller.test.ts
GVM_ROOT=$HOME/.gvm git commit -m "feat(server): RouterController handles Streamable HTTP POST"
```

---

### Task 5: Wire into `AppModule` + cleanup timer

**Files:**
- Modify: `apps/server/src/app.module.ts`
- Modify: `apps/server/src/streamable-http.session-registry.ts` (add `OnModuleInit`/`OnModuleDestroy` for reaper)

**Interfaces:**
- Consumes: `StreamableHttpController`, `StreamableHttpSessionRegistry`.
- Produces: registered controller + provider in NestJS module; reaper `setInterval` running every 1h.

- [ ] **Step 1: Add lifecycle hooks to registry**

Modify `apps/server/src/streamable-http.session-registry.ts`:

Change class signature:
```typescript
import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
```

```typescript
@Injectable()
export class StreamableHttpSessionRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly sessions = new Map<string, Session>();
  private reaper: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    this.reaper = setInterval(() => this.reapExpired(), 60 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
    for (const sid of Array.from(this.sessions.keys())) this.delete(sid);
  }

  // ... rest unchanged
}
```

- [ ] **Step 2: Update module registration**

Modify `apps/server/src/app.module.ts`:

Add imports:
```typescript
import { StreamableHttpController } from "./streamable-http.controller.js";
import { StreamableHttpSessionRegistry } from "./streamable-http.session-registry.js";
```

Add `StreamableHttpController` to `controllers` array (alongside `SseController`, `RouterController`).

Add `StreamableHttpSessionRegistry` to `providers` array (alongside `SseSessionRegistry`).

- [ ] **Step 3: Typecheck**

```bash
cd apps/server && GVM_ROOT=$HOME/.gvm pnpm typecheck
```
Expected: PASS.

- [ ] **Step 4: Run full server test suite**

```bash
cd apps/server && GVM_ROOT=$HOME/.gvm pnpm test
```
Expected: PASS all suites (including new ones).

- [ ] **Step 5: Commit**

```bash
GVM_ROOT=$HOME/.gvm git add apps/server/src/app.module.ts apps/server/src/streamable-http.session-registry.ts
GVM_ROOT=$HOME/.gvm git commit -m "feat(server): register StreamableHttp controller + reaper"
```

---

### Task 6: Client transport `StreamableHttpTransport`

**Files:**
- Create: `packages/transport/src/streamable-http.ts`
- Modify: `packages/transport/src/index.ts` (register)
- Test: `packages/transport/src/streamable-http.test.ts`

**Interfaces:**
- Consumes: `StreamableHttpTransportDescriptor` (Task 1), `Session`/`Transport` from `packages/transport/src/index.ts`.
- Produces:
  ```typescript
  export class StreamableHttpTransport implements Transport {
    readonly kind: "streamable-http";
    open(descriptor: TransportDescriptor): Promise<Session>;
  }
  ```
- `Session.send(frame)`:
  - if `frame.method === "initialize"` → POST without `Mcp-Session-Id`, read header from response, store as `sessionId`, parse JSON body
  - else → POST with `Mcp-Session-Id` + `Accept: text/event-stream`; parse response: if `content-type` includes `text/event-stream` → read first `event: message\ndata: <json>\n\n` frame; else parse JSON body
- `Session.close()`: DELETE with `Mcp-Session-Id`.

- [ ] **Step 1: Write failing test using undici MockAgent**

Create `packages/transport/src/streamable-http.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify fail**

```bash
cd packages/transport && GVM_ROOT=$HOME/.gvm pnpm exec vitest run src/streamable-http.test.ts
```
Expected: FAIL module-not-found.

- [ ] **Step 3: Implement client transport**

Create `packages/transport/src/streamable-http.ts`:

```typescript
import { request } from "undici";
import type { MCPFrame, TransportDescriptor } from "@mavio/core";
import { bearerHeaderFromAuth, MavioError } from "@mavio/core";
import type { Session, Transport } from "./index.js";

class StreamableHttpSession implements Session {
  private sessionId: string | null = null;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string>,
  ) {}

  async send(frame: MCPFrame): Promise<MCPFrame> {
    const isInitialize = frame.method === "initialize";
    const reqHeaders: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.headers,
    };
    if (this.sessionId) reqHeaders["mcp-session-id"] = this.sessionId;

    const res = await request(this.url, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(frame),
    });

    if (res.statusCode >= 400) {
      throw new MavioError(
        `streamable-http POST ${res.statusCode}`,
        "TRANSPORT_HTTP_ERROR",
      );
    }

    if (isInitialize) {
      const sid = res.headers["mcp-session-id"];
      if (typeof sid === "string") this.sessionId = sid;
      else if (Array.isArray(sid) && sid[0]) this.sessionId = sid[0];
    }

    const ctypeRaw = res.headers["content-type"];
    const ctype = Array.isArray(ctypeRaw) ? ctypeRaw[0] ?? "" : ctypeRaw ?? "";

    if (ctype.includes("text/event-stream")) {
      return parseFirstSseFrame(res.body);
    }
    const body = (await res.body.json()) as MCPFrame;
    return body;
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await request(this.url, {
        method: "DELETE",
        headers: {
          "mcp-session-id": this.sessionId,
          ...this.headers,
        },
      });
    } catch {
      /* best-effort */
    }
    this.sessionId = null;
  }
}

async function parseFirstSseFrame(
  body: AsyncIterable<Buffer> | { text(): Promise<string> },
): Promise<MCPFrame> {
  let buffer = "";
  const iter = body as AsyncIterable<Buffer>;
  for await (const chunk of iter) {
    buffer += chunk.toString("utf8");
    const idx = buffer.indexOf("\n\n");
    if (idx !== -1) {
      const raw = buffer.slice(0, idx);
      return sseEventToFrame(raw);
    }
  }
  throw new MavioError("streamable-http: empty SSE body", "TRANSPORT_HTTP_ERROR");
}

function sseEventToFrame(raw: string): MCPFrame {
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  const data = dataLines.join("\n");
  return JSON.parse(data) as MCPFrame;
}

export class StreamableHttpTransport implements Transport {
  readonly kind = "streamable-http" as const;

  async open(descriptor: TransportDescriptor): Promise<Session> {
    if (descriptor.type !== "streamable-http") {
      throw new MavioError(
        "wrong descriptor for streamable-http transport",
        "TRANSPORT_MISMATCH",
      );
    }
    const headers: Record<string, string> = {
      ...(descriptor.headers ?? {}),
      ...bearerHeaderFromAuth(descriptor.auth),
    };
    return new StreamableHttpSession(descriptor.url, headers);
  }
}
```

- [ ] **Step 4: Register in TransportManager**

Modify `packages/transport/src/index.ts`:

Add import at top:
```typescript
import { StreamableHttpTransport } from "./streamable-http.js";
```

In `TransportManager` constructor, add after `this.register(new WsTransport())`:
```typescript
this.register(new StreamableHttpTransport());
```

Add re-export at bottom:
```typescript
export { StreamableHttpTransport } from "./streamable-http.js";
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd packages/transport && GVM_ROOT=$HOME/.gvm pnpm exec vitest run src/streamable-http.test.ts
```
Expected: PASS all 4 tests.

- [ ] **Step 6: Commit**

```bash
GVM_ROOT=$HOME/.gvm git add packages/transport/src/streamable-http.ts packages/transport/src/streamable-http.test.ts packages/transport/src/index.ts
GVM_ROOT=$HOME/.gvm git commit -m "feat(transport): StreamableHttpTransport client (MCP 2025-03 mode B)"
```

---

### Task 7: End-to-end smoke test + docs

**Files:**
- Create: `apps/server/src/streamable-http.e2e.test.ts`
- Modify: `docs/adr/` — append note to relevant ADR OR create `docs/adr/023-streamable-http-transport.md`

**Interfaces:**
- Consumes: whole feature stack.
- Produces: single integration test spinning up Nest test module, exercising POST-initialize → GET stream → POST tools/list → DELETE.

- [ ] **Step 1: Write e2e test**

Create `apps/server/src/streamable-http.e2e.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { StreamableHttpController } from "./streamable-http.controller.js";
import { StreamableHttpSessionRegistry } from "./streamable-http.session-registry.js";

describe("Streamable HTTP e2e (registry + controller only)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [StreamableHttpController],
      providers: [StreamableHttpSessionRegistry],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /mcp without Mcp-Session-Id → 404", async () => {
    await request(app.getHttpServer()).get("/mcp").expect(404);
  });

  it("DELETE /mcp without Mcp-Session-Id → 404", async () => {
    await request(app.getHttpServer()).delete("/mcp").expect(404);
  });

  it("DELETE /mcp with valid session → 200", async () => {
    const registry = app.get(StreamableHttpSessionRegistry);
    const sid = registry.create();
    await request(app.getHttpServer())
      .delete("/mcp")
      .set("Mcp-Session-Id", sid)
      .expect(200);
    expect(registry.has(sid)).toBe(false);
  });
});
```

Note: if `supertest` is not already a devDep, add to `apps/server/package.json`:
```bash
cd apps/server && GVM_ROOT=$HOME/.gvm pnpm add -D supertest @types/supertest
```

- [ ] **Step 2: Run test to verify pass**

```bash
cd apps/server && GVM_ROOT=$HOME/.gvm pnpm exec vitest run src/streamable-http.e2e.test.ts
```
Expected: PASS all 3 tests.

- [ ] **Step 3: Add ADR**

Create `docs/adr/023-streamable-http-transport.md`:

```markdown
# ADR-023: Streamable HTTP Transport (MCP 2025-03 Mode B)

**Status:** Accepted (2026-08-10)

## Context

MCP spec 2025-03 introduces "Streamable HTTP" transport where session state
is carried in the `Mcp-Session-Id` HTTP header and the server MAY reply to
POSTs either as `application/json` or as `text/event-stream` bodies.
Client-initiated notifications flow through a separate `GET /mcp` SSE
stream keyed by the same session id.

Mavio already exposes classic MCP HTTP+SSE (`GET /mcp/sse` +
`POST /mcp?sid=<uuid>`). Modern MCP clients (Claude Desktop 2025-Q2+,
new SDKs) expect Streamable HTTP.

## Decision

Add a parallel `POST /mcp` + `GET /mcp` + `DELETE /mcp` Streamable HTTP
endpoint. Session state lives in a new `StreamableHttpSessionRegistry`.
Classic SSE endpoints and their registry remain unchanged.

- POST without `Mcp-Session-Id` + `frame.method === "initialize"` → create
  session, return `Mcp-Session-Id` header + JSON body.
- POST with `Mcp-Session-Id`, `Accept: text/event-stream` → reply SSE body.
- POST with `Mcp-Session-Id`, other Accept → reply JSON body.
- GET with `Mcp-Session-Id` → attach SSE push stream for notifications.
- DELETE with `Mcp-Session-Id` → terminate session.

Session TTL 24 h; buffer up to 100 notifications when no GET stream open.

## Consequences

- Two active MCP HTTP transports until deprecation timeline (out of scope).
- No changes to `RouterService`, so both transports share dispatch logic.
- Server-initiated MCP requests (server → client `request`, not
  `notification`) still not implemented.
```

- [ ] **Step 4: Full workspace typecheck + test**

```bash
cd "$(git rev-parse --show-toplevel)" && GVM_ROOT=$HOME/.gvm pnpm -r typecheck && GVM_ROOT=$HOME/.gvm pnpm -r test
```
Expected: PASS everywhere.

- [ ] **Step 5: Commit**

```bash
GVM_ROOT=$HOME/.gvm git add apps/server/src/streamable-http.e2e.test.ts apps/server/package.json apps/server/../../pnpm-lock.yaml docs/adr/023-streamable-http-transport.md
GVM_ROOT=$HOME/.gvm git commit -m "test(server): streamable-http e2e + ADR-023"
```

---

## Self-Review Notes

- Spec sections covered:
  - Streamable session registry → Task 2
  - GET /mcp, DELETE /mcp → Task 3
  - POST /mcp (initialize + streaming reply + JSON reply) → Task 4
  - AppModule wiring + reaper → Task 5
  - Client transport → Task 6
  - Descriptor type → Task 1
  - Docs + e2e → Task 7
- Signatures cross-checked: `create()`, `has()`, `touch()`, `attachPushStream()`, `pushNotification()`, `delete()`, `reapExpired()` — same names across Tasks 2/3/4/5.
- Constructor arity of `RouterController` changed in Task 4 (from 3 to 4 args); Task 5 registers new provider so DI resolves. Test file constructs directly, matching order.
- Fallback branch in `RouterController` preserves plain POST /mcp (no session, no `?sid`, not initialize) → 400. That matches the spec's "reject non-initialize without session".
