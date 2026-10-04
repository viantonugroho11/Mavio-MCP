# ADR-028: Resource subscription fan-out over Streamable HTTP

**Status:** Proposed
**Date:** 2026-10-04
**Deciders:** Platform Architecture
**Depends on:** ADR-022 (egress bus), ADR-023, ADR-027

## Context
ADR-022 defines an egress notification bus across replicas. What is missing
is the MCP-facing layer: `resources/subscribe` and
`notifications/resources/updated` semantics on top of it. Without it, each
downstream session that subscribes to an upstream resource opens its own
upstream subscription. N agents watching the same resource means N upstream
subscriptions, and many upstreams do not support subscriptions at all.

## Decision
The gateway owns subscriptions and dedupes them upstream.

- Subscription registry: `resourceUri → Set<sessionId>`, in the shared store
  (ADR-027).
- First subscriber triggers one upstream subscription; the last unsubscribe
  (or session expiry) tears it down after a grace period.
- Upstream change → publish once on the ADR-022 bus → each replica delivers
  `notifications/resources/updated` to its local subscribed sessions.
- **Polling shim** for upstreams without subscribe support: optional
  `poll: { interval, hash: etag|body }`, which emits an update only on change.
  This makes resources on OpenAPI/SQL/GraphQL imports subscribable.
- RBAC re-checked at delivery time, so a revoked principal stops receiving updates.
- Event Bridge ingress (webhooks) can mark resources updated, which gives
  push without polling.

## Options Considered
### Option A: Pass-through subscriptions per session
Simple; O(N) upstream load; no support for non-MCP upstreams.
### Option B: Gateway-owned, deduped subscriptions + polling shim (chosen)
### Option C: Expose the bus directly (topics) to clients
Non-standard; clients would need custom code.

## Trade-off Analysis
The polling shim costs upstream load and adds latency equal to the interval.
It stays opt-in per resource with a minimum interval guard. Dedup assumes the
upstream resource is identical for all principals; resources whose content
varies per principal must be keyed `(uri, principalId)`.

## Consequences
- Turns REST/SQL backends into "live" MCP resources, which no plain MCP server offers.
- Delivery to disconnected sessions relies on ADR-024 replay.

## Action Items
1. Implement `resources/subscribe`/`unsubscribe` in the router.
2. Subscription registry on top of the ADR-027 store.
3. Polling shim with change detection.
4. Wire into ADR-022 egress bus; E2E with 2 replicas.
