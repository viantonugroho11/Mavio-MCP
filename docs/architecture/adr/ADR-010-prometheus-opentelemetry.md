# ADR-010: Prometheus + OpenTelemetry for observability

**Status:** Accepted
**Date:** 2026-08-03
**Deciders:** Platform Architecture, SRE

## Context
Every non-trivial deployment needs metrics, traces, and structured logs. Vendor lock-in is unacceptable for an OSS project.

## Decision
Expose **Prometheus** metrics endpoints on every app and emit traces + logs via **OpenTelemetry (OTLP)**. No vendor SDKs baked in.

## Options Considered

### Option A: Prometheus + OpenTelemetry
**Pros:** Vendor-neutral; ubiquitous; works with Grafana, Datadog, Honeycomb, New Relic; auto-instrumentation available for Node.
**Cons:** Some vendor-specific features not exposed.

### Option B: Datadog / New Relic SDK
**Pros:** Best-in-class per vendor.
**Cons:** Lock-in inappropriate for OSS.

### Option C: Home-grown telemetry
**Pros:** Full control.
**Cons:** Reinventing wheels; contributors have to learn our conventions.

## Trade-off Analysis
Standard formats mean users bring their own backend; we don't gatekeep observability.

## Consequences
- Every request carries a trace id; audit records reference the same id for correlation.
- Metric naming follows Prometheus conventions (`mavio_router_requests_total`, `_seconds`, `_bytes`).
- Revisit only if OpenTelemetry semantic conventions materially change (adopt new versions on major releases).

## Action Items
- [ ] Metric catalog documented in `@mavio/audit`.
- [ ] Reference Grafana dashboards shipped in `tooling/docker`.
- [ ] Trace id propagation contract for plugins.
