# ADR-005: Single MCP endpoint via Router

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** Platform Architecture, Protocol Lead

## Context
Clients (IDEs, agents) today must configure each MCP server individually — creds, transports, URLs. This is a scaling problem: one workspace can have dozens of servers. We also need one place to enforce auth, RBAC, audit, and rate limits.

## Decision
Expose **all registered MCP servers behind a single `/mcp` endpoint**. Multiplex requests using namespaced tool names (`<serverId>.<tool>`). Auth, RBAC, and audit run in the router.

## Options Considered

### Option A: Single endpoint with namespacing
**Pros:** One client config; central policy enforcement; central observability; simpler onboarding.
**Cons:** Router is a hot path; tool-name collisions require namespacing; single blast radius.

### Option B: Per-server endpoints
**Pros:** Blast radius isolated per server.
**Cons:** Client config explodes; policy enforcement smeared across N surfaces.

### Option C: DNS-based routing (`svc-orders.mcp.example.com`)
**Pros:** Clean URL model.
**Cons:** TLS/DNS ops burden for OSS users; still needs a common policy layer.

## Trade-off Analysis
Blast radius mitigated by (a) horizontally scaling stateless router replicas, (b) circuit breakers per server, and (c) session pinning for stdio servers via Redis lease. The onboarding win — one URL, one credential — is decisive.

## Consequences
- Router owns auth, RBAC, rate limits, audit.
- Namespacing spec must be part of the public contract.
- Optional flat exposure per project remains available but validated at config time for collisions.
- Revisit if router p99 latency or blast-radius incidents force a shard-per-tenant model.

## Action Items
- [ ] Namespacing spec doc.
- [ ] Collision detection in `mavio.config.yaml` validator.
- [ ] Per-server circuit breaker + audit ID propagation.
