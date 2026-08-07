# ADR-020: Trace Inspector — per-invoke transform tracing, replay, and schema-drift detection

**Status:** Proposed
**Date:** 2026-08-07
**Deciders:** Platform Architecture, SRE, Security, DevEx

## Context
Mavio sits between MCP clients and backends, transforming each `tools/call` into a concrete backend request (OpenAPI/SQL/GraphQL/MCP) and mapping the response back. When a tool misbehaves, operators today **leave Mavio** and inspect the backend service directly (Postman, curl, backend logs). That workflow is blind to the layer Mavio actually owns: the **transform** (schema mapping, auth injection, param coercion). A 200-with-wrong-body, a dropped field, or a coerced type looks identical to "backend is fine" from outside.

The pieces that would answer "why did this call fail" are scattered or absent:
- `playground_runs` holds request+response **only** for playground-originated calls, not real `/mcp` traffic.
- `audit_events` (ADR-016) captures request arguments but **explicitly not response bodies** (too large) and **not the post-transform backend request**.
- `capability snapshots` (ADR-005) record the *expected* schema but nothing compares live responses against them.

So no single artifact reconstructs a real failing invocation. This ADR decides whether — and how — to capture and surface that.

The forcing constraint is data availability: the router streams/proxies for latency and memory efficiency. Reconstructing a trace requires buffering bodies that today are never retained. That is a cost (latency, storage, secret-exposure) decision, not a UI decision.

## Decision
Introduce a **Trace Inspector**: an opt-in, sampled capture of the full invocation path plus a debugging surface over it.

**Per-invoke trace shape** (`invocation_traces`, one row per captured `tools/call`):
```
id              uuid          — shared with audit_events.id for correlation
timestamp       timestamptz
principal_id    text
workspace_id    text
server_id       text
tool_name       text
client_request  jsonb         — args client sent to Mavio (redacted)
backend_request jsonb         — method, url/query, headers, body AFTER transform (redacted)
backend_response jsonb        — status, headers, body (redacted, size-capped)
client_response jsonb         — what Mavio returned to the client
hops            jsonb         — [{stage, started_at, duration_ms, outcome}]
fail_stage      text          — null | transform_request | backend | transform_response | schema_validate
schema_diff     jsonb         — null | drift vs capability snapshot
node_id         text
```

**Fail-stage classification** — the trace records where the invocation broke, distinguishing the four hops so "backend vs Mavio" is answered without leaving the UI:
- `transform_request` — Mavio failed to build the backend call.
- `backend` — backend returned a transport/HTTP error (5xx, timeout, connection).
- `transform_response` — backend responded but Mavio failed mapping it back.
- `schema_validate` — backend returned success but the body violates the tool's declared output schema (the "200 with garbage" case).

**Schema-drift detection** — on captured traces, diff the live backend response shape against the tool's capability snapshot (ADR-005 already stores it). Emit `schema_diff` when fields disappear, types change, or required fields go missing. This reuses existing snapshot infrastructure; it is not a new subsystem.

**Replay** — `POST /api/traces/:id/replay` re-issues the captured invocation (optionally with edited params) through the normal router path, producing a new trace. No manual reproduction. Replay is a real invocation — it obeys RBAC and rate limits and is itself audited.

**Capture policy (the cost control):**
- **Off by default.** Enabled per-server or per-workspace via `trace.enabled`.
- **Sampled** — `trace.sampleRate` (default 0 when enabled must be set explicitly) plus **always-capture-on-error** (`trace.captureAllErrors: true` default): failures are the whole point, so capture 100% of non-ok outcomes regardless of sample rate.
- **Size-capped** — bodies over `trace.maxBodyBytes` (default 64 KiB) stored truncated with a marker.
- **Redacted** — reuse ADR-016 `redactKeys`; applied to backend_request headers/body (auth injection lands here, so this is mandatory, not optional).
- **Short retention** — `trace.retentionDays` default 7 (traces are for active debugging, not compliance; audit stays the long-term record).

**Anomaly surface** — the two failure classes the operator named get distinct treatment:
- *Backend broken* (down/5xx/slow): p95 latency + error-rate per tool, from existing Prometheus metrics (ADR-010) — no new capture needed. Trace Inspector links out to the offending traces.
- *Silent shape change* (schema drift): driven by `schema_diff`; a drift alert fires when a tool's live responses diverge from its snapshot beyond `trace.driftThreshold`.

**Surfaces:**
- Web: per-tool "Traces" tab — timeline of invocations, fail-stage pill filter, click into a trace showing all four hops side by side with the failing hop highlighted; "Replay" button.
- API: `GET /api/traces?server=&tool=&failStage=&from=&to=`, `GET /api/traces/:id`, `POST /api/traces/:id/replay`.
- CLI: `mavio trace tail --server X --errors-only`, `mavio trace replay <id>`.

## Options Considered

### Option A: Dedicated `invocation_traces` table, opt-in + error-biased sampling (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Med — new capture hook in router transform path |
| Cost | Bounded — off by default, sampled, capped, 7-day retention |
| Scalability | Sampling + short retention keep volume bounded |
| Team familiarity | High — mirrors ADR-016 audit + playground_runs patterns |
| Reversibility | High — additive table + optional hook; disable = zero cost |

**Pros:** Purpose-built schema (four-hop model), reuses snapshot diff + audit redaction, cost is opt-in so OSS/solo users pay nothing until they turn it on.
**Cons:** Second body-capturing store alongside playground_runs; router transform path gains a conditional capture branch.

### Option B: Extend `audit_events` to carry backend request + response
**Pros:** One table.
**Cons:** Directly reverses ADR-016's deliberate "no response bodies" decision; bloats the compliance record with debug data on a 90-day retention; conflates two lifecycles (7-day debug vs 90-day audit) with opposite volume/retention needs.

### Option C: Reuse `playground_runs` for all `/mcp` traffic
**Pros:** Table exists.
**Cons:** Playground runs model a different origin, lack post-transform backend request and hop timing, and have no fail-stage/drift concept — retrofitting loses schema clarity (same reasoning ADR-016 used to reject it).

### Option D: OTLP-only — rely on OpenTelemetry spans, no Mavio-native store
**Pros:** Scales trivially, no new table.
**Cons:** OSS/solo users forced to run a trace backend to debug anything; spans don't carry redacted bodies by default; no replay; drift detection has nowhere to live. Kills the "debug without leaving Mavio" goal.

## Trade-off Analysis
The core tension is **cost of capture vs value of visibility**. The router avoids buffering bodies for good reason. Option A resolves it by making capture opt-in and error-biased: the common path (success, tracing off) is untouched; the expensive path (buffering a body) only runs when someone is actively debugging a server or when a call fails — which is exactly when the data is worth its cost. Short retention keeps storage bounded and keeps debug data out of the compliance surface. Reusing snapshot diff and audit redaction means the net-new surface is the capture hook and the viewer, not a new platform.

Rejecting Option B matters: keeping traces separate from audit preserves ADR-016's guarantees (bounded audit volume, no large bodies in the compliance record) instead of eroding them.

## Consequences
- **Easier:** operators diagnose "backend vs transform" without leaving Mavio; silent schema drift becomes visible; failing calls are replayable.
- **Harder:** the router transform path gains a capture branch that must be genuinely zero-cost when disabled; redaction correctness now guards a second store that holds post-auth-injection backend requests (security review required — this is the highest-risk surface).
- **Config surface grows:** `trace.enabled`, `trace.sampleRate`, `trace.captureAllErrors`, `trace.maxBodyBytes`, `trace.redactKeys` (inherits audit), `trace.retentionDays`, `trace.driftThreshold`.
- **Revisit when:** trace write volume competes with audit/DB budget → move body storage to an object-store sink (S3/gzip) with the DB holding only metadata + pointer. Revisit retention if replay-from-old-trace becomes a common workflow.

## Riskiest Assumption (validate before building)
> The router can be made to capture post-transform request + backend response with acceptable latency/memory cost, and redaction reliably scrubs injected credentials from `backend_request`.

Cheapest test: add a temporary, single-server capture that dumps `backend_request` (post-transform) + `backend_response` to a JSONL file behind a flag. Next real incident, confirm the file alone resolves root cause without opening the backend — and audit the dump for leaked secrets. If it does → build; if operators still need the backend → the gap is elsewhere and this ADR is premature.

## Action Items
- [ ] Spike: temporary flagged JSONL capture on one server; validate root-cause-from-trace + secret redaction (gates the whole ADR).
- [ ] Migration: `invocation_traces` table + `(server_id, tool_name, timestamp DESC)` and `(fail_stage, timestamp DESC)` indexes; monthly partition or short-retention auto-drop.
- [ ] Router: capture hook in the transform dispatch path — no-op when `trace.enabled` false; error-biased sampling; body cap + redaction (reuse `@mavio/audit` redactor).
- [ ] `SchemaDiffService` in `@mavio/registry` — diff live response vs capability snapshot; emit `schema_diff` + drift metric.
- [ ] `POST /api/traces/:id/replay` through the normal router path (RBAC + rate limit + audited).
- [ ] API `GET /api/traces(?filters)` + `/:id`; CLI `mavio trace tail|replay`; web per-tool "Traces" tab.
- [ ] Config schema in `@mavio/config`; security review of `backend_request` redaction before GA.
- [ ] Retention/auto-drop job (worker fleet, or server cron for MVP).
