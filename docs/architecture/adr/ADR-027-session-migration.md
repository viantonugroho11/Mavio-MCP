# ADR-027: Session continuity across replicas (shared session state)

**Status:** Proposed
**Date:** 2026-10-04
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
