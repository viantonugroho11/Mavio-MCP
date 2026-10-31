# ADR-027: Redis-backed session metadata + node-local streams

**Status:** Accepted
**Date:** 2026-10-31
**Deciders:** Platform Architecture
**Depends on:** ADR-025, ADR-024

## Context

`StreamableHttpSessionRegistry` stores session metadata (created/lastSeen timestamps) and
SSE push streams in an in-process `Map`. With multiple replicas any `POST /mcp` request
routed to a replica that did not create the session fails the `has()` check and returns 404.
Likewise, push notifications sent by replica B cannot reach the SSE stream held by replica A.

## Decision

**Shared metadata via Redis Hash, node-local streams.**

- Session metadata (`createdAt`, `lastSeenAt`) stored in Redis Hash `mavio:sess:streamable:{id}`.
  TTL = 25 h (1 h beyond SESSION_TTL_MS) for auto-expiry.
- SSE streams and pending-notification buffers remain node-local (no serialization of open
  HTTP connections across processes).
- Cross-replica push notification delivery via Redis pub/sub channel `mavio:push:{sessionId}`.
  Any replica with no local push stream publishes to the channel; the replica that holds
  the stream receives via `psubscribe("mavio:push:*")`.
- A dedicated `REDIS_PUSH_SUB` connection pattern-subscribes on module init. A dedicated
  `REDIS` connection (already provided by `CacheModule`) is the publisher.

### Interface introduced

```ts
export interface StreamableSessionStore {
  create(sessionId?: string): Promise<string>;
  has(sessionId: string): Promise<boolean>;
  touch(sessionId: string): Promise<boolean>;
  get(sessionId: string): Promise<StreamableSessionMetadata | undefined>;
  delete(sessionId: string): Promise<boolean>;
  listAll(): Promise<StreamableSessionMetadata[]>;
  reapExpired(now?: number): Promise<number>;
}
```

`MemoryStreamableSessionStore` (in `@mavio/transport`) is used in tests; production wires
`RedisStreamableSessionStore` via a factory provider in `AppModule`.

### Key changes

- `StreamableHttpSessionRegistry.has()` is now `async` — all callers updated.
- `StreamableHttpSessionRegistry.create()` is now `async` — session must be in Redis before
  the `Mcp-Session-Id` header is returned to the client.
- `StreamableHttpSessionRegistry.touch()` is fire-and-forget (void).
- `AppBootstrapService.onModuleInit()` calls `registry.setPubSub(redis, pushSub)` to wire
  cross-replica delivery after construction.

## Options Considered

### Option A: Sticky sessions (LB level)
Keep in-memory; route all requests for a session to the same replica.
Rejected: hard to guarantee with health restarts; not enough when replicas scale to zero.

### Option B: Full session serialization (chosen baseline)
Store all session state (including event replay log) in Redis.
Deferred: event replay log is handled by `EventStore`; a `RedisEventStore` is the next step.
This ADR handles session metadata only.

### Option C: Shared metadata + node-local streams (chosen)
Best tradeoff: metadata visible to all replicas enables routing; streams stay local (no
serialization of open connections). Cross-replica push handled by lightweight pub/sub.

## Consequences

- One extra Redis connection per node (`REDIS_PUSH_SUB`) for the pattern subscription.
- Pub/sub delivery for cross-replica push is best-effort (fire-and-forget publish); if the
  target replica crashes between subscribe and receive, the notification is lost. Pending
  buffer on reconnect still works within a single replica.
- `reapExpired` in Redis mode uses `SCAN` (O(N) on key space); Redis TTL handles most cleanup
  automatically.
- Tests use `MemoryStreamableSessionStore` — no Redis required in CI.
