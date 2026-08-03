# ADR-003: Redis for cache & coordination

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** Platform Architecture

## Context
Router hot path must avoid DB reads; rate limits need atomic counters; health probes need pub/sub invalidation; workers need a job queue; router replicas need distributed leases for stdio server ownership.

## Decision
Use **Redis 7+** for capability cache, session state, rate-limit counters, pub/sub, worker queues (BullMQ), and router leases.

## Options Considered

### Option A: Redis
**Pros:** One dependency covers cache + pub/sub + queues + leases; ubiquitous; BullMQ is mature.
**Cons:** Single-threaded-ish; memory pressure with large payloads.

### Option B: KeyDB / Dragonfly
**Pros:** Multi-threaded, higher throughput.
**Cons:** Smaller ops community; treat as drop-in replacement later if needed.

### Option C: In-memory + gossip
**Pros:** No extra service.
**Cons:** Complex to make correct; blocks horizontal scaling.

### Option D: Postgres LISTEN/NOTIFY + advisory locks
**Pros:** No new dependency.
**Cons:** Weaker throughput for hot-path cache; queues become fragile.

## Trade-off Analysis
Redis-compatible protocol keeps the door open to Dragonfly/KeyDB if throughput becomes an issue, without app code changes.

## Consequences
- All Redis usage must be namespaced (`hermes:<workspace>:...`) and TTL'd.
- Router must degrade gracefully if Redis is briefly unavailable (fail-open reads with backoff, fail-closed writes).
- Revisit if Redis memory > 30% of budget or p99 latency > 5ms sustained.

## Action Items
- [ ] Key namespace convention doc.
- [ ] Circuit-breaker for Redis in router.
- [ ] Load-test with KeyDB/Dragonfly at Phase 3.
