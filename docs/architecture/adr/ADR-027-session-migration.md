# ADR-027: Session continuity across replicas (shared session state)

**Status:** Accepted (partially implemented — see Implementation status)
**Date:** 2026-10-04 · **Accepted:** 2026-10-31
**Deciders:** Platform Architecture, SRE
**Depends on:** ADR-023, ADR-024 · **Relates:** Phase 4b (etcd/consul), Phase 4e

## Context
`StreamableHttpSessionRegistry` is in-process. When a request with
`Mcp-Session-Id` hits a replica that did not create the session, it gets 404
and the client must re-initialize. Today this forces sticky load balancing,
which breaks on scale-in, rolling deploys and cross-region failover. The
recent push-only TTL fix (3760740) shows session lifecycle is already a source of bugs.

## Decision
Make session **metadata** shared and session **streams** node-local.

- `SessionStore` interface holding `SessionRecord` (ADR-025) plus negotiated
  capabilities/protocol version from `initialize`. Backends: `memory`
  (default), `redis`; etcd/consul are not used here (they are a poor fit for
  high-churn keys, so they stay for config per Phase 4b).
- Any replica can serve a POST for any live session by loading the record.
- Push stream (`GET /mcp`) is attached to one replica. Notifications for a
  session are published to `session:<id>` on the shared bus; the replica
  holding the stream delivers them. Resume after replica loss uses ADR-024.
- TTL and reaping move to the store (single source of truth); the reaper uses a
  lease so only one replica reaps a given session.
- Stateful upstreams (ADR-026 `per-session` stdio) remain pinned: the record
  stores `ownerNode`, and other replicas forward to it, or return
  `mavio/session_pinned` with a retry hint if it is gone.

## Options Considered
### Option A: Require sticky sessions (document it)
Zero code. Fails on deploys and failover.
### Option B: Shared metadata, local streams (chosen)
### Option C: Fully shared streams (every replica can write any stream)
Requires distributed stream ownership; complexity is not justified.

## Trade-off Analysis
Adds a Redis round trip per request for a session lookup. Mitigation: a
local cache with short TTL plus invalidation on DELETE. Sessions pinned to
stateful upstreams cannot migrate; that is honest and explicit, not hidden.

## Consequences
- Helm chart: Redis becomes recommended for replicas > 1.
- Removes sticky-session requirement for stateless upstreams.
- Same store powers ADR-024 (events) and ADR-025 (counters), so one infra dependency serves all three.

## Action Items
1. Extract `SessionStore` from the registry; memory implementation keeps current behaviour.
2. Redis store + pub/sub delivery to the stream owner.
3. Chaos test: kill the replica holding a session mid-call; client continues.
4. Helm values + DEPLOYMENT.md update.

## Implementation status
Shipped in commit 25deddf (2026-10-31):

- **Item 1 — done.** `StreamableSessionStore` interface and
  `MemoryStreamableSessionStore` in `@mavio/transport`
  (`packages/transport/src/streamable-session-store.ts`). The store holds
  `{ sessionId, createdAt, lastSeenAt }` only; the ADR-025 `McpSessionRecord`
  and negotiated capabilities are still in-process (`McpSessionStore`).
- **Item 2 — done.** `RedisStreamableSessionStore`
  (`apps/server/src/redis-streamable-session-store.ts`): one Redis Hash per
  session at `mavio:sess:streamable:{id}`, TTL 25 h, refreshed on `touch`.
  Cross-replica push goes over pub/sub channel `mavio:push:{sessionId}`; every
  replica pattern-subscribes `mavio:push:*` on a dedicated `REDIS_PUSH_SUB`
  connection and writes to its local stream if it holds one.
- `StreamableHttpSessionRegistry.has()` and `create()` are now async;
  `create()` awaits the Redis write so the `Mcp-Session-Id` returned to the
  client is already visible to every replica. `touch()` is fire-and-forget.
- Streams and the pending-notification buffer stay node-local. A replica with
  no local stream publishes instead of buffering.

Still open:

- Lease-based reaping (today every replica's reaper scans; Redis TTL does most
  of the cleanup).
- `ownerNode` pinning and forwarding for stateful upstreams (depends on ADR-026).
- Local read cache with short TTL in front of `has()`.
- Moving `McpSessionRecord` (ADR-025 counters) into the shared store.
- Item 3 (chaos test) and item 4 (Helm values, DEPLOYMENT.md).
- Pub/sub delivery is best-effort: a notification published while no replica
  holds the stream is lost, not buffered. Replay via ADR-024 needs a shared
  `EventStore` (Redis) to cover that case.
