# ADR-024: Resumable Streamable HTTP streams (`Last-Event-ID` replay)

**Status:** Proposed
**Date:** 2026-10-04
**Deciders:** Platform Architecture, SRE
**Depends on:** ADR-023, ADR-022 · **Feeds:** ADR-020, ADR-025

## Context
ADR-023 shipped Streamable HTTP with a per-session buffer of up to 100
notifications while no `GET /mcp` stream is attached. Two gaps remain:

1. SSE events carry no stable `id:`, so a client that drops mid-response
   (long `tools/call` streaming progress) cannot resume. It must re-issue the
   call, which is unsafe for non-idempotent tools.
2. The buffer is in-process. A reconnect that lands on another replica (K8s
   rolling deploy, multi-region per Phase 4e) loses everything.

The MCP spec allows servers to attach event IDs and honour `Last-Event-ID`
on reconnect. Plain MCP servers rarely do; a gateway can do it once for
every upstream. That makes this a differentiator, not spec parity.

## Decision
Assign a monotonic per-stream event ID to every SSE event emitted on
`POST /mcp` (response streams) and `GET /mcp` (push stream). Persist events
in a bounded **EventStore** keyed `(sessionId, streamId)`. On `GET /mcp`
with `Last-Event-ID`, replay events after that ID, then go live.

- ID format: `<streamId>:<seq>` so one header identifies stream and position.
- Retention: count (default 1000) **and** age (default 10 min), whichever hits first.
- Store interface `EventStore { append, readAfter, trim }`; implementations:
  `memory` (default, single node) and `redis` (Streams `XADD`/`XRANGE`)
  for multi-replica.
- Replay gap (ID trimmed): send `notifications/message` with level `warning`
  and code `mavio/replay_gap`, then continue live. Never fail silently.
- Response streams for a completed `tools/call` remain replayable until the
  retention window ends, so a client can recover the final result.

## Options Considered
### Option A: In-memory ring buffer only
Pros: zero dependencies. Cons: breaks on replica change; does not solve gap 2.
### Option B: EventStore interface, memory + Redis (chosen)
Pros: single-node stays simple; HA deployments opt in. Cons: Redis becomes
soft dependency for HA; storage cost scales with payload size.
### Option C: Reuse ADR-022 bus (Kafka/NATS) as the log
Pros: one durable log. Cons: per-session random read-after is a poor fit for
topic logs; ties a core transport feature to optional Event Bridge.

## Trade-off Analysis
Durability vs cost. Tool results can be large; storing them for 10 min
multiplies memory. Mitigation: cap per-event size (default 256 KiB). Oversized
events are stored as a stub that tells the client to re-fetch.

## Consequences
- Long tool calls survive network blips and deploys (Redis mode).
- Event bodies may contain sensitive data; the store must reuse ADR-020
  redaction rules and Redis must be TLS + auth.
- Event IDs give ADR-020 a natural cursor for trace timelines.

## Action Items
1. Spike: measure overhead of ID assignment + memory store on SSE hot path.
2. Define `EventStore` in `packages/transport`; memory implementation first.
3. Redis implementation behind `transport.streamable.eventStore: redis`.
4. E2E: kill connection mid-stream, reconnect with `Last-Event-ID`, assert no loss.
5. Metrics: `mavio_stream_replay_total`, `mavio_stream_replay_gap_total`.
