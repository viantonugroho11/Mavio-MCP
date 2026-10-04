# ADR-025: Session as the operational unit (quota, policy, cost, trace)

**Status:** Proposed
**Date:** 2026-10-04
**Deciders:** Platform Architecture, Security, DevEx
**Depends on:** ADR-023 · **Relates:** ADR-016, ADR-020, ADR-024

## Context
`Mcp-Session-Id` is used today for routing only. All governance (rate limit,
RBAC, audit, metrics) keys on principal/API key. That does not match how
agents behave: one API key runs many concurrent agent sessions, and a single
runaway session (tool-call loop) burns the whole key's quota and hides inside
aggregate metrics.

Operators ask session-shaped questions: "what did this agent run do?",
"which session is looping?", "what did this conversation cost?".

## Decision
Promote the session to a first-class entity with its own metadata and
limits, layered **under** existing principal-level controls (never instead of them).

- `SessionRecord { id, principalId, clientInfo, transport, createdAt,
  lastSeenAt, callCount, errorCount, bytesIn, bytesOut, costUnits, labels }`
  — `clientInfo` is taken from `initialize`.
- Optional per-session limits: `maxCalls`, `maxCallsPerMinute`,
  `maxCostUnits`, `maxDuration`. Breach returns JSON-RPC error `-32029`
  (`mavio/session_limit`) and emits an audit event.
- **Loop guard:** same tool + same argument hash more than N times in a window
  is flagged; it can be configured to block.
- Every audit event and trace (ADR-016, ADR-020) carries `sessionId`, so
  "one session = one timeline" holds without joins on time.
- Admin API: `GET /admin/sessions`, `GET /admin/sessions/:id`,
  `DELETE /admin/sessions/:id` (force terminate, which ends any SSE streams).
- Classic SSE sessions get the same record, so the model does not depend on
  the transport.

## Options Considered
### Option A: Labels only (session ID in logs/metrics)
Cheap, but no enforcement. High-cardinality metrics risk.
### Option B: Session record + optional limits (chosen)
Enforcement where it matters; metrics stay per-principal, while session detail
lives in the record and audit store.
### Option C: Replace principal limits with session limits
Rejected: sessions are client-minted in effect, so a client could bypass a
limit by opening new sessions.

## Trade-off Analysis
Session counters on the hot path need atomic increments; in multi-replica
mode they need shared state (same backend as ADR-024/026). Limits are
best-effort across replicas (eventual counters), and hard limits stay at the
principal level.

## Consequences
- Never put session ID in Prometheus labels (cardinality); expose it via
  admin API and traces only.
- The Inspector UI gets a sessions view, which is the entry point for ADR-020.
- Billing/chargeback becomes possible later via `costUnits`.

## Action Items
1. Define `SessionRecord` + store (memory, then shared backend).
2. Thread `sessionId` through router context into audit + trace.
3. Limits + loop guard middleware, off by default.
4. Admin endpoints + Inspector sessions list.
