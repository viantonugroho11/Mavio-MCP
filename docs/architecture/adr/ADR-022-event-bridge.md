# ADR-022: Event Bridge (webhook/stream ↔ MCP)

**Status:** Proposed
**Date:** 2026-08-09
**Deciders:** Platform team

## Context
MCP is request/response JSON-RPC over stdio/HTTP/SSE. Two gaps have surfaced:

1. **Ingress asynchrony.** External systems (GitHub webhooks, Kafka topics,
   Slack events, cron-emitted messages) cannot trigger MCP tools today. Users
   wire ad-hoc glue services outside the gateway, bypassing our RBAC, audit,
   Vault-scoped upstream credentials, and trace inspector.
2. **Egress fanout.** SSE/WS notifications (Phase 4a) terminate on a single
   replica. A subscriber that reconnects to a different pod loses in-flight
   notifications; multi-region deployments have no bus.

Kong's Event Gateway (referenced in the request) is a full native-Kafka broker
with schema registry, topic ACLs, and replay. Adopting that scope would
duplicate the broker ecosystem and pull us off the MCP altitude. What we do
need is the *policy edge* around events: authenticated ingress that maps to
MCP tool calls, and reliable fanout of MCP notifications across replicas.

## Decision
Introduce an **Event Bridge** subsystem with two directions, sharing existing
router infra (RBAC, audit, Vault, trace inspector):

- **Ingress:** `POST /api/events/:route` and native Kafka/NATS consumer.
  Route config maps `(source, topic|path, filter)` → `mcp.tools/call` with a
  principal identity. Payload validated against a per-route JSON Schema,
  authenticated via HMAC / mTLS / OIDC-per-source.
- **Egress:** MCP notification bus. Router publishes tool progress /
  `notifications/*` frames to Redis Streams (reusing ADR-003 coordination).
  SSE/WS handlers subscribe to per-session stream keys with resume-from-offset
  on reconnect.

Explicit **non-goals:** we do NOT implement a Kafka-protocol broker, schema
registry, topic storage, or consumer group management. Bring your own broker;
we sit at the edge.

## Options Considered

### Option A: Bridge only (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium — one ingress controller, one bus adapter, one route table |
| Reuse | High — RBAC, audit, Vault, trace inspector all apply unchanged |
| Scope | Bounded — no broker, no storage, no replay UI |
| Multi-region | Solved for notifications via Redis Streams / NATS JetStream |

**Pros:** ships in a phase, keeps altitude, immediate day-2 value (webhook →
MCP + notification durability). Composable with any external broker.
**Cons:** users still need their own Kafka/NATS for cross-service pub/sub.
No native replay of raw events (only MCP-audit replay).

### Option B: Hybrid — bridge + embedded lightweight broker (NATS JetStream in-process)
| Dimension | Assessment |
|---|---|
| Complexity | High — persistent storage, backup, quotas per tenant |
| Reuse | Medium — needs new admin surface for topics/streams |
| Scope | Creeps — topic ACLs, retention policy, DLQ |

**Cons:** operational burden (disk, backup, quota) doesn't match a gateway's
job. Users who already run Kafka get two brokers to reason about.

### Option C: Full Event Gateway (native Kafka protocol front-end)
| Dimension | Assessment |
|---|---|
| Complexity | Very high — Kafka wire protocol, consumer groups, schema registry |
| Reuse | Low — parallel data plane to MCP router |
| Team fit | Wrong altitude — competes with Kong/Confluent/Redpanda |

**Cons:** multi-quarter effort, duplicates a mature ecosystem, no clear
differentiation from Kong EE.

## Trade-off Analysis
Option A delivers ~80% of the user-visible value (async triggers + reliable
notifications) with ~20% of the scope. It preserves the "MCP router" identity
and reuses every P0 subsystem hardened over Phases 1–4. B and C add broker
responsibilities that don't compound with our roadmap (Trace Inspector,
marketplace, multi-region cache).

## Consequences
- New package: `packages/event-bridge` (ingress controller + bus adapter).
- Registry gains `event_routes` table: `id, source_type, match, mcp_target,
  principal_id, schema_ref, created_by, approval_status`. Reuses ADR-021
  approval workflow — non-admin submits, admin approves before route arms.
- Router `notifications/*` emit path forks: local subscribers (fast path) +
  bus publish (durable). Reconnect handshake carries `last-event-id` for
  Redis Stream `XREAD` resume.
- Audit trail (ADR-016) records both `event.received` and derived
  `tools/call`, linked by `correlation_id`.
- Trace Inspector (ADR-020) shows event ingress as the root span.
- Metrics: `mavio_event_ingress_total{source,route,outcome}`,
  `mavio_notification_bus_lag_seconds`.
- Bus adapter is pluggable — Redis Streams default, NATS JetStream and Kafka
  optional. No hard dependency on any single broker.

## Action Items
1. [ ] Spike: measure current SSE reconnect gap on a killed replica (baseline).
2. [ ] Draft `event_routes` migration + registry API.
3. [ ] Prototype webhook ingress (HMAC + JSON Schema validate) → `tools/call`.
4. [ ] Prototype Redis Streams egress with `last-event-id` resume.
5. [ ] Decide bus default (Redis Streams vs NATS JetStream) after spike.
6. [ ] Update RBAC scopes: `event:route.submit`, `event:route.approve`,
       `event:publish`.
7. [ ] Follow-up ADR if Kafka native ingress demanded (revisit Option C).
