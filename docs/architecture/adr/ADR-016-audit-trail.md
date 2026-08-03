# ADR-016: Audit trail — what is captured, where it lives, how it's queried

**Status:** Proposed
**Date:** 2026-08-03
**Deciders:** Platform Architecture, Security, SRE

## Context
Mavio-MCP mediates every MCP call between clients and backend servers. That position obligates it to answer, per action: **who called what, when, with what arguments, against which resource, with what result, at what latency**. Today (v0.1.x) only `playground_runs` and structured console logs exist — that is not enough for compliance, incident forensics, or usage analytics.

## Decision
Introduce a single append-only `audit_events` table plus a pluggable external sink. Every state-changing or invocation action emits an event; read-only fetches do not (with the one exception below).

**Event shape:**
```
id              uuid          — event id, returned in HTTP headers for correlation
timestamp       timestamptz
principal_id    text          — who
principal_type  text          — user | service | anon
workspace_id    text
kind            text          — see catalogue
action          text          — canonical action string (e.g. tool:invoke, server:write)
resource        jsonb         — { workspace, project, server, tool } as applicable
request         jsonb         — method, path, arguments (redacted per rules)
outcome         text          — allow | deny | ok | error
error_code      text          — nullable
latency_ms      int
node_id         text          — router replica that handled it
trace_id        text          — OpenTelemetry trace id (Phase 3+)
```

**Kinds captured (v0.2):**
- `mcp.tool.call` — every `tools/call` through `/mcp` and every `POST /api/playground/invoke`. Arguments captured, response NOT (too large; correlate via `playground_runs` row for playground calls).
- `mcp.tools.list` — captured with a **1% sample rate** to bound volume; toggle via config.
- `admin.mutation` — every `POST/PUT/PATCH/DELETE` on `/api/*` (servers, imports, principals, assignments).
- `auth.event` — successful auth, failed auth, key issued, key revoked.
- `config.change` — every write to `mavio.config.yaml` (Phase 2 when write API lands).
- `health.state_change` — only on transition (`healthy → down`, `down → healthy`).

**Redaction:**
- Arguments matching keys in `audit.redactKeys` config (default: `password`, `token`, `secret`, `apiKey`, `authorization`) are replaced with `"[redacted]"` before persistence.
- SQL importer bind values redacted the same way.
- Router refuses to log if a serialized argument exceeds `audit.maxArgBytes` (default 32 KiB); replaced with `"[truncated]"`.

**Storage:**
- Postgres partitioned monthly (`audit_events_YYYY_MM`). Indexes: `(timestamp DESC)`, `(principal_id, timestamp DESC)`, `(resource->>'server', timestamp DESC)`.
- Retention: 90 days in-DB by default (`audit.retentionDays`). Auto-drop old partitions.
- **Optional external sink** via `AuditSink` interface — ships with adapters for file (JSONL append), OTLP logs, S3 (batch, gzip). Enabled per config; events fire-and-forget to a bounded queue in the router (drop policy: log-and-continue when queue full to protect the request path).

**Query API:**
- `GET /api/audit/events?principal=&server=&action=&from=&to=&limit=` — reads restricted to `workspace:admin` and workspace-scoped by the caller's principal.
- `GET /api/audit/events/:id` — single event lookup.
- CLI: `mavio audit tail [--server X] [--follow]`.

**Web console:**
- Per-server tab "Audit" shows last N events with pill filters (deny only, error only, tool invoke only).
- Global `/audit` page with time-range picker + CSV export.

**Correlation:**
- The router emits `x-mavio-audit-id` on every HTTP response. Playground runs and audit events share the id when the invocation went through the playground endpoint.
- Trace IDs propagate to backend HTTP dispatchers via `traceparent` header for downstream correlation.

## Options Considered

### Option A: Own `audit_events` table + optional external sink (chosen)
**Pros:** Simple bootstrap, works offline, GDPR/SOC2 story starts on day one, integrates with existing SnapshotsController pattern.
**Cons:** Postgres holds hot audit volume; must partition or move; retention discipline required.

### Option B: External-only (OTLP / Kafka)
**Pros:** Scales trivially.
**Cons:** OSS users forced to run Kafka/Loki to get anything at all; no local investigation without a backend.

### Option C: Reuse `playground_runs` for everything
**Pros:** Table already exists.
**Cons:** Playground runs are a small subset with response bodies; conflating both loses schema clarity and forces trade-offs neither wins.

## Trade-off Analysis
Postgres audit is fast, transactional-adjacent (we can write the event in the same request), and cheap. The escape hatch to a durable sink means high-volume deployments aren't cornered.

## Consequences
- Every mutating handler and the router hot path get a small write on the response side; use a fire-and-forget queue so latency budget is preserved.
- Config surface grows: `audit.retentionDays`, `audit.redactKeys`, `audit.maxArgBytes`, `audit.sampleRates`, `audit.sinks[]`.
- Backup / GDPR obligations kick in — retention default (90 days) and delete-on-request path required for `type:"user"` principals.
- Revisit if audit write volume exceeds 20% of DB write budget — then push to sink-first with async DB indexer.

## Action Items
- [ ] Migration: `audit_events` table + monthly partition scaffolding + indexes.
- [ ] `AuditService` in a new `@mavio/audit` package (interface + Postgres impl + queue).
- [ ] `AuditInterceptor` (NestJS) wraps every controller; router adds a middleware for `/mcp`.
- [ ] `AuditSink` interface + File / OTLP / S3 reference adapters.
- [ ] `GET /api/audit/events(?filters)` + CLI + web `/audit` page.
- [ ] Config schema updates in `@mavio/config`.
- [ ] Retention job in worker fleet (Phase 3) — for MVP a cron in the server suffices.
